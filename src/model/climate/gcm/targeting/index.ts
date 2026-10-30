import { GCM_ATMOSPHERE } from "@/model/climate/gcm/atmosphere"
import { GCM_BALANCE } from "@/model/climate/gcm/balance"
import type {
	GcmTargetAssessment,
	GcmTargetForcing,
	GcmTargetState,
	GcmTargetUpdate,
} from "@/model/climate/gcm/targeting/types"
import type { GcmConfig } from "@/model/climate/gcm/types"

const TOLERANCE_K = 0.5
const MIN_YEARS = 20
const WINDOW_YEARS = 10
const MAX_YEARS = 200
const MAX_ADJUSTMENTS = 24
const MAX_TEMPERATURE_DRIFT_K = 0.2
const MAX_ENERGY_IMBALANCE_WM2 = 1
const MIN_CO2_PPM = 0.001
const MAX_CO2_PPM = 100_000
const SEARCH_FACTOR = 2
const MIN_LOG_INTERVAL = 0.001

function create(config: GcmConfig): GcmTargetState {
	const result = GCM_ATMOSPHERE.resolve(config.atmosphere)
	if (result.ok === false) throw new Error(result.message)
	const target = config.targetTemperatureK
	if (target === null || !Number.isFinite(target) || target <= 0)
		throw new Error("Desired temperature must be above absolute zero")
	const co2Ppm = result.values.co2Ppm
	if (co2Ppm > MAX_CO2_PPM)
		throw new Error(
			"Temperature targeting requires initial CO₂ at or below 100,000 ppm",
		)
	return {
		status: "settling",
		initialCo2Ppm: co2Ppm,
		co2Ppm,
		trialStartYear: null,
		yearsAtForcing: 0,
		meanTemperatureK: null,
		message: "Waiting for complete years at the starting CO₂",
		history: [],
	}
}

function forcing({ config, co2Ppm }: GcmTargetForcing): GcmConfig {
	return {
		...config,
		atmosphere: GCM_ATMOSPHERE.setFixedCo2Ppm({
			config: config.atmosphere,
			co2Ppm,
		}),
	}
}

function assess({
	state,
	targetK,
	years,
}: GcmTargetAssessment): GcmTargetState {
	if (state.status !== "settling" || state.trialStartYear === null) return state
	const startYear = state.trialStartYear
	const trial = years.filter((year) => year.year > startYear)
	const recent = trial.slice(-WINDOW_YEARS)
	const yearsAtForcing = trial.length
	if (!recent.length) return state
	const meanTemperatureK =
		recent.reduce((sum, year) => sum + year.surfaceTemperature, 0) /
		recent.length
	const progress = { ...state, yearsAtForcing, meanTemperatureK }
	if (
		trial.some(
			(year, index) => index > 0 && year.year !== trial[index - 1].year + 1,
		)
	)
		return {
			...progress,
			status: "limited",
			message: "Incomplete annual history; targeting paused",
		}
	const half = WINDOW_YEARS / 2
	const temperatureDrift = Math.abs(
		recent.reduce(
			(sum, year, index) =>
				sum + year.surfaceTemperature * (index < half ? -1 : 1),
			0,
		) / half,
	)
	const toa = Math.abs(
		recent.reduce((sum, year) => sum + year.toaNetRadiation, 0) / recent.length,
	)
	const surface = Math.abs(
		recent.reduce((sum, year) => sum + year.surfaceNetHeat, 0) / recent.length,
	)
	const settled =
		yearsAtForcing >= MIN_YEARS &&
		temperatureDrift <= MAX_TEMPERATURE_DRIFT_K &&
		toa <= MAX_ENERGY_IMBALANCE_WM2 &&
		surface <= MAX_ENERGY_IMBALANCE_WM2 &&
		GCM_BALANCE.assess(trial).status === "balanced"
	if (!settled) {
		return {
			...progress,
			status: yearsAtForcing >= MAX_YEARS ? "limited" : "settling",
			message:
				yearsAtForcing >= MAX_YEARS
					? "Climate did not settle within 200 years at this CO₂; targeting paused"
					: `Settling climate · ${yearsAtForcing} complete years at this CO₂`,
		}
	}
	if (Math.abs(meanTemperatureK - targetK) <= TOLERANCE_K)
		return {
			...progress,
			status: "converged",
			message: "Settled within the desired temperature range",
		}
	if (state.co2Ppm === 0 && meanTemperatureK > targetK)
		return {
			...progress,
			status: "limited",
			message:
				"CO₂ is already zero; cooling further requires changing another forcing",
		}
	if (state.history.length >= MAX_ADJUSTMENTS)
		return {
			...progress,
			status: "limited",
			message: "Reached 24 CO₂ adjustments; targeting paused",
		}
	const points = [
		...state.history.map((entry) => ({
			co2: entry.fromCo2Ppm,
			temperature: entry.temperatureK,
		})),
		{ co2: state.co2Ppm, temperature: meanTemperatureK },
	]
	const cold = points
		.filter((point) => point.temperature < targetK)
		.sort((a, b) => b.co2 - a.co2)[0]
	const warm = points
		.filter((point) => point.temperature > targetK)
		.sort((a, b) => a.co2 - b.co2)[0]
	if (cold && warm && cold.co2 >= warm.co2)
		return {
			...progress,
			status: "limited",
			message: "Climate response reversed across trials; targeting paused",
		}
	const candidate =
		cold && warm
			? Math.sqrt(Math.max(MIN_CO2_PPM, cold.co2) * warm.co2)
			: meanTemperatureK < targetK
				? Math.max(MIN_CO2_PPM, state.co2Ppm * SEARCH_FACTOR)
				: state.co2Ppm / SEARCH_FACTOR
	const next = Math.max(MIN_CO2_PPM, Math.min(MAX_CO2_PPM, candidate))
	if (
		Math.abs(Math.log(next / Math.max(MIN_CO2_PPM, state.co2Ppm))) <
			MIN_LOG_INTERVAL &&
		state.co2Ppm !== 0
	)
		return {
			...progress,
			status: "limited",
			message:
				"CO₂ bound or narrow climate transition reached; target may be unreachable",
		}
	return {
		...progress,
		status: "adjusting",
		message: "Applying the next CO₂ adjustment",
		history: [
			...state.history,
			{
				year: trial[trial.length - 1].year,
				temperatureK: meanTemperatureK,
				fromCo2Ppm: state.co2Ppm,
				toCo2Ppm: next,
			},
		],
	}
}

function validate({ config, state }: GcmTargetUpdate) {
	const initial = create(config)
	if (
		!state ||
		!["settling", "converged", "limited"].includes(state.status) ||
		!Number.isFinite(state.co2Ppm) ||
		state.co2Ppm < 0 ||
		state.co2Ppm > MAX_CO2_PPM ||
		!Number.isFinite(state.initialCo2Ppm) ||
		state.initialCo2Ppm < 0 ||
		state.initialCo2Ppm > MAX_CO2_PPM ||
		Math.abs(initial.co2Ppm - state.co2Ppm) > 1e-6 ||
		(state.trialStartYear !== null &&
			!Number.isInteger(state.trialStartYear)) ||
		!Number.isInteger(state.yearsAtForcing) ||
		state.yearsAtForcing < 0 ||
		(state.meanTemperatureK !== null &&
			!Number.isFinite(state.meanTemperatureK)) ||
		!Array.isArray(state.history) ||
		state.history.length > MAX_ADJUSTMENTS ||
		state.history.some(
			(entry) =>
				!Number.isInteger(entry.year) ||
				!Number.isFinite(entry.temperatureK) ||
				!Number.isFinite(entry.fromCo2Ppm) ||
				entry.fromCo2Ppm < 0 ||
				entry.fromCo2Ppm > MAX_CO2_PPM ||
				!Number.isFinite(entry.toCo2Ppm) ||
				entry.toCo2Ppm < MIN_CO2_PPM ||
				entry.toCo2Ppm > MAX_CO2_PPM,
		)
	)
		throw new Error("Invalid temperature targeting checkpoint state")
}

export const GCM_TARGETING = { create, forcing, assess, validate, TOLERANCE_K }
