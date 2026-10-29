import type {
	GcmAtmosphereConfig,
	GcmAtmosphereResult,
	GcmCo2Change,
	GcmGasDefinition,
} from "@/model/climate/gcm/atmosphere/types"

const UNIVERSAL_GAS_CONSTANT = 8314.46261815324
const NATIVE_PRESSURE_BAR = 1.011
const NATIVE_MEAN_MOLAR_MASS = 28.970253
const NATIVE_GAS_CONSTANT = UNIVERSAL_GAS_CONSTANT / NATIVE_MEAN_MOLAR_MASS
const NATIVE_CO2_PPM = 300

const GASES: ReadonlyArray<GcmGasDefinition> = [
	{
		id: "H2",
		label: "Hydrogen (H₂)",
		molarMass: 2.01588,
		nativeFraction: 0.55e-6,
	},
	{
		id: "He",
		label: "Helium (He)",
		molarMass: 4.002602,
		nativeFraction: 5.24e-6,
	},
	{
		id: "N2",
		label: "Nitrogen (N₂)",
		molarMass: 28.0134,
		nativeFraction: 0.78084,
	},
	{
		id: "O2",
		label: "Oxygen (O₂)",
		molarMass: 31.9988,
		nativeFraction: 0.20946,
	},
	{ id: "Ar", label: "Argon (Ar)", molarMass: 39.948, nativeFraction: 0.00934 },
	{
		id: "Ne",
		label: "Neon (Ne)",
		molarMass: 20.1797,
		nativeFraction: 18.18e-6,
	},
	{
		id: "Kr",
		label: "Krypton (Kr)",
		molarMass: 83.798,
		nativeFraction: 1.14e-6,
	},
	{
		id: "CO2",
		label: "Carbon dioxide (CO₂)",
		molarMass: 44.01,
		nativeFraction: NATIVE_CO2_PPM * 1e-6,
	},
	{
		id: "H2O",
		label: "Water vapor (H₂O)",
		molarMass: 18.01528,
		nativeFraction: 0,
	},
]

const DEFAULT_CONFIG: GcmAtmosphereConfig = {
	mode: "partialPressures",
	partialPressures: {
		H2: null,
		He: null,
		N2: null,
		O2: null,
		Ar: null,
		Ne: null,
		Kr: null,
		CO2: null,
		H2O: null,
	},
	pressureBar: null,
	gasConstant: null,
	ozone: true,
}

function resolve(config: GcmAtmosphereConfig): GcmAtmosphereResult {
	let specifiedPressureBar = 0
	let weightedMass = 0
	for (const gas of GASES) {
		const pressure = config.partialPressures[gas.id]
		if (pressure === null) continue
		if (!Number.isFinite(pressure) || pressure < 0)
			return {
				ok: false,
				message: `${gas.label} partial pressure must be finite and nonnegative.`,
			}
		specifiedPressureBar += pressure
		weightedMass += pressure * gas.molarMass
	}
	if (!Number.isFinite(specifiedPressureBar) || !Number.isFinite(weightedMass))
		return {
			ok: false,
			message: "The specified atmosphere is too large to calculate.",
		}
	let pressureBar = specifiedPressureBar || NATIVE_PRESSURE_BAR
	let gasConstant =
		specifiedPressureBar > 0
			? UNIVERSAL_GAS_CONSTANT / (weightedMass / specifiedPressureBar)
			: NATIVE_GAS_CONSTANT
	if (config.mode === "pressureAndGasConstant") {
		pressureBar = config.pressureBar ?? NATIVE_PRESSURE_BAR
		gasConstant = config.gasConstant ?? NATIVE_GAS_CONSTANT
	} else if (config.mode !== "partialPressures") {
		return { ok: false, message: "Choose an atmosphere input mode." }
	}
	if (
		!Number.isFinite(pressureBar) ||
		pressureBar <= 0 ||
		!Number.isFinite(gasConstant) ||
		gasConstant <= 0
	)
		return {
			ok: false,
			message: "Total pressure and gas constant must be finite and positive.",
		}
	if (specifiedPressureBar > pressureBar + 1e-12 * Math.max(1, pressureBar))
		return {
			ok: false,
			message: "The specified partial pressures exceed total surface pressure.",
		}
	const co2 = config.partialPressures.CO2
	const warnings: string[] = []
	if (pressureBar < 0.1 || pressureBar > 10)
		warnings.push(
			"Outside 0.1–10 bar the model may need a much shorter timestep, possibly 5 minutes. Change Timestep under Numerics.",
		)
	if (
		config.mode === "pressureAndGasConstant" &&
		config.gasConstant === null &&
		specifiedPressureBar > 0
	)
		warnings.push(
			"The gas constant is still Earth’s value. If your gas list is incomplete, enter a gas constant for the whole atmosphere.",
		)
	return {
		ok: true,
		values: {
			warnings,
			pressureBar,
			gasConstant,
			co2Ppm:
				co2 === null ? NATIVE_CO2_PPM : Math.min(1, co2 / pressureBar) * 1e6,
			meanMolarMass: UNIVERSAL_GAS_CONSTANT / gasConstant,
			specifiedPressureBar,
		},
	}
}

function setCo2Ppm({ config, co2Ppm }: GcmCo2Change): GcmAtmosphereConfig {
	if (co2Ppm === null)
		return {
			...config,
			partialPressures: { ...config.partialPressures, CO2: null },
		}
	if (!Number.isFinite(co2Ppm) || co2Ppm < 0 || co2Ppm > 1e6) return config
	const result = resolve(config)
	if (!result.ok) return config
	const fraction = co2Ppm / 1e6
	const backgroundPressure = GASES.reduce(
		(total, gas) =>
			total + (gas.id === "CO2" ? 0 : (config.partialPressures[gas.id] ?? 0)),
		0,
	)
	if (config.mode === "partialPressures" && backgroundPressure > 0) {
		if (fraction === 1) return config
		return {
			...config,
			partialPressures: {
				...config.partialPressures,
				CO2: (backgroundPressure * fraction) / (1 - fraction),
			},
		}
	}
	return {
		...config,
		mode: "pressureAndGasConstant",
		pressureBar: result.values.pressureBar,
		gasConstant: result.values.gasConstant,
		partialPressures: {
			...config.partialPressures,
			CO2: result.values.pressureBar * fraction,
		},
	}
}

export const GCM_ATMOSPHERE = {
	DEFAULT_CONFIG,
	GASES,
	NATIVE_PRESSURE_BAR,
	NATIVE_GAS_CONSTANT,
	resolve,
	setCo2Ppm,
}
