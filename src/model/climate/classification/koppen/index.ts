import { KOPPEN_OCEAN } from "@/model/climate/classification/koppen/ocean"
import type { KoppenCellsParams } from "@/model/climate/classification/koppen/types"

const KOPPEN_CLASSES = [
	{
		code: "Ocean",
		name: "Ocean",
		color: [0.29, 0.44, 0.65] as [number, number, number],
	},
	{
		code: "Af",
		name: "Tropical rainforest",
		color: [0 / 255, 0 / 255, 254 / 255] as [number, number, number],
	},
	{
		code: "Am",
		name: "Tropical monsoon",
		color: [0 / 255, 119 / 255, 255 / 255] as [number, number, number],
	},
	{
		code: "Aw",
		name: "Tropical savanna",
		color: [70 / 255, 169 / 255, 250 / 255] as [number, number, number],
	},
	{
		code: "As",
		name: "Tropical savanna (dry summer)",
		color: [127 / 255, 201 / 255, 255 / 255] as [number, number, number],
	},
	{
		code: "BWh",
		name: "Hot desert",
		color: [254 / 255, 0 / 255, 0 / 255] as [number, number, number],
	},
	{
		code: "BWk",
		name: "Cold desert",
		color: [254 / 255, 150 / 255, 149 / 255] as [number, number, number],
	},
	{
		code: "BSh",
		name: "Hot steppe",
		color: [245 / 255, 163 / 255, 1 / 255] as [number, number, number],
	},
	{
		code: "BSk",
		name: "Cold steppe",
		color: [255 / 255, 219 / 255, 99 / 255] as [number, number, number],
	},
	{
		code: "Cfa",
		name: "Humid subtropical",
		color: [198 / 255, 255 / 255, 78 / 255] as [number, number, number],
	},
	{
		code: "Cfb",
		name: "Oceanic",
		color: [102 / 255, 255 / 255, 51 / 255] as [number, number, number],
	},
	{
		code: "Cfc",
		name: "Subpolar oceanic",
		color: [51 / 255, 199 / 255, 1 / 255] as [number, number, number],
	},
	{
		code: "Csa",
		name: "Hot-summer Mediterranean",
		color: [255 / 255, 255 / 255, 0 / 255] as [number, number, number],
	},
	{
		code: "Csb",
		name: "Warm-summer Mediterranean",
		color: [198 / 255, 199 / 255, 0 / 255] as [number, number, number],
	},
	{
		code: "Csc",
		name: "Cold-summer Mediterranean",
		color: [150 / 255, 150 / 255, 0 / 255] as [number, number, number],
	},
	{
		code: "Cwa",
		name: "Humid subtropical (monsoon)",
		color: [150 / 255, 255 / 255, 150 / 255] as [number, number, number],
	},
	{
		code: "Cwb",
		name: "Subtropical highland",
		color: [99 / 255, 199 / 255, 100 / 255] as [number, number, number],
	},
	{
		code: "Cwc",
		name: "Cold subtropical highland",
		color: [50 / 255, 150 / 255, 51 / 255] as [number, number, number],
	},
	{
		code: "Dfa",
		name: "Hot-summer continental",
		color: [0 / 255, 255 / 255, 255 / 255] as [number, number, number],
	},
	{
		code: "Dfb",
		name: "Warm-summer continental",
		color: [56 / 255, 199 / 255, 255 / 255] as [number, number, number],
	},
	{
		code: "Dfc",
		name: "Subarctic",
		color: [0 / 255, 126 / 255, 125 / 255] as [number, number, number],
	},
	{
		code: "Dfd",
		name: "Extremely cold subarctic",
		color: [0 / 255, 69 / 255, 94 / 255] as [number, number, number],
	},
	{
		code: "Dsa",
		name: "Hot-summer continental (dry summer)",
		color: [255 / 255, 0 / 255, 254 / 255] as [number, number, number],
	},
	{
		code: "Dsb",
		name: "Warm-summer continental (dry summer)",
		color: [198 / 255, 0 / 255, 199 / 255] as [number, number, number],
	},
	{
		code: "Dsc",
		name: "Subarctic (dry summer)",
		color: [150 / 255, 50 / 255, 149 / 255] as [number, number, number],
	},
	{
		code: "Dsd",
		name: "Extremely cold subarctic (dry summer)",
		color: [150 / 255, 100 / 255, 149 / 255] as [number, number, number],
	},
	{
		code: "Dwa",
		name: "Hot-summer continental (monsoon)",
		color: [171 / 255, 177 / 255, 255 / 255] as [number, number, number],
	},
	{
		code: "Dwb",
		name: "Warm-summer continental (monsoon)",
		color: [90 / 255, 119 / 255, 219 / 255] as [number, number, number],
	},
	{
		code: "Dwc",
		name: "Subarctic (monsoon)",
		color: [76 / 255, 81 / 255, 181 / 255] as [number, number, number],
	},
	{
		code: "Dwd",
		name: "Extremely cold subarctic (monsoon)",
		color: [50 / 255, 0 / 255, 135 / 255] as [number, number, number],
	},
	{
		code: "ET",
		name: "Tundra",
		color: [178 / 255, 178 / 255, 178 / 255] as [number, number, number],
	},
	{
		code: "EF",
		name: "Ice cap",
		color: [104 / 255, 104 / 255, 104 / 255] as [number, number, number],
	},
	...KOPPEN_OCEAN.CLASSES,
] as const

const koppenLabels = KOPPEN_CLASSES.map(
	(entry) => entry.code,
) as ReadonlyArray<string>

const CLASS_ID: Record<string, number> = Object.fromEntries(
	KOPPEN_CLASSES.map((entry, index) => [entry.code, index]),
)

function koppenCells({
	start,
	end,
	isLand,
	temperatureMonthly,
	surfaceTemperatureMonthly,
	seaIcePercentMonthly,
	rainfallMonthly,
	classes,
}: KoppenCellsParams): void {
	const N = isLand.length
	// Reusable buffers, avoiding per-cell allocations
	const mTemps = new Float64Array(12)
	const mRain = new Float64Array(12)

	for (let r = start; r < end; r++) {
		if (!isLand[r]) {
			let minimumTemperatureC = Infinity
			let minimumIceFraction = Infinity
			let maximumIceFraction = -Infinity
			for (let month = 0; month < 12; month++) {
				const index = month * N + r
				minimumTemperatureC = Math.min(
					minimumTemperatureC,
					surfaceTemperatureMonthly[index],
				)
				minimumIceFraction = Math.min(
					minimumIceFraction,
					seaIcePercentMonthly[index] / 100,
				)
				maximumIceFraction = Math.max(
					maximumIceFraction,
					seaIcePercentMonthly[index] / 100,
				)
			}
			classes[r] =
				CLASS_ID[
					KOPPEN_OCEAN.classify({
						minimumTemperatureC,
						minimumIceFraction,
						maximumIceFraction,
					})
				]
			continue
		}

		// Koppen_Alg in koppenpasta.py with its default options.
		let hot = -Infinity,
			cold = Infinity,
			tempSum = 0
		let annualRain = 0,
			driestMonth = Infinity
		let monthsAbove10 = 0
		for (let month = 0; month < 12; month++) {
			const t = temperatureMonthly[month * N + r]
			const rain = rainfallMonthly[month * N + r]
			mTemps[month] = t
			mRain[month] = rain
			if (t > hot) hot = t
			if (t < cold) cold = t
			tempSum += t
			annualRain += rain
			if (rain < driestMonth) driestMonth = rain
			if (t > 10) monthsAbove10++
		}
		const annualTemp = tempSum / 12

		// Summer is the warmest six-month window. Upstream only tries windows
		// starting in months 0–5, which misplaces southern summers; every
		// start is tried here.
		let summerStart = 0
		let warmest = -Infinity
		for (let start = 0; start < 12; start++) {
			let sum = 0
			for (let offset = 0; offset < 6; offset++)
				sum += mTemps[(start + offset) % 12]
			if (sum > warmest) {
				warmest = sum
				summerStart = start
			}
		}
		let summerRain = 0,
			driestSummer = Infinity,
			wettestSummer = -Infinity,
			driestWinter = Infinity
		for (let offset = 0; offset < 12; offset++) {
			const rain = mRain[(summerStart + offset) % 12]
			if (offset < 6) {
				summerRain += rain
				driestSummer = Math.min(driestSummer, rain)
				wettestSummer = Math.max(wettestSummer, rain)
			} else driestWinter = Math.min(driestWinter, rain)
		}

		const aridityThreshold =
			20 * annualTemp +
			(summerRain > 0.7 * annualRain
				? 280
				: summerRain > 0.3 * annualRain
					? 140
					: 0)
		if (annualRain < aridityThreshold) {
			const hotArid = cold > 0
			if (annualRain < aridityThreshold / 2) {
				classes[r] = hotArid ? CLASS_ID.BWh : CLASS_ID.BWk
			} else {
				classes[r] = hotArid ? CLASS_ID.BSh : CLASS_ID.BSk
			}
			continue
		}

		if (hot < 10) {
			classes[r] = hot < 0 ? CLASS_ID.EF : CLASS_ID.ET
			continue
		}

		if (cold > 18) {
			if (driestMonth > 60) classes[r] = CLASS_ID.Af
			else if (driestMonth > 100 - annualRain / 25) classes[r] = CLASS_ID.Am
			else if (summerRain < annualRain / 2) classes[r] = CLASS_ID.As
			else classes[r] = CLASS_ID.Aw
			continue
		}

		const drySummer =
			driestSummer < 30 &&
			wettestSummer > 3 * driestSummer &&
			summerRain < annualRain / 2
		const dryWinter = wettestSummer > 10 * driestWinter
		const precipLetter = drySummer ? "s" : dryWinter ? "w" : "f"

		let tempLetter: "a" | "b" | "c" | "d"
		if (monthsAbove10 < 4) tempLetter = cold > -38 ? "c" : "d"
		else tempLetter = hot > 22 ? "a" : "b"

		if (cold > 0) {
			classes[r] =
				CLASS_ID[`C${precipLetter}${tempLetter === "d" ? "c" : tempLetter}`]
			continue
		}

		classes[r] = CLASS_ID[`D${precipLetter}${tempLetter}`]
	}
}

function koppenClimateColor(classId: number): [number, number, number] {
	return KOPPEN_CLASSES[classId]?.color ?? KOPPEN_CLASSES[0].color
}

function koppenClimateName(classId: number): string {
	return KOPPEN_CLASSES[classId]?.name ?? KOPPEN_CLASSES[0].name
}

export const KOPPEN = {
	koppenLabels,
	koppenCells,
	koppenClimateColor,
	koppenClimateName,
}
