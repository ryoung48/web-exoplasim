import { GCM_ATMOSPHERE } from "@/model/climate/gcm/atmosphere"
import type {
	GcmConfigChange,
	GcmContinuationFields,
} from "@/model/climate/gcm/continuation/types"
import type { GcmConfig } from "@/model/climate/gcm/types"

const EDITABLE: ReadonlyArray<keyof GcmConfig> = [
	"fluxWm2",
	"starTemperatureK",
	"obliquityDeg",
	"eccentricity",
	"periapseLongitudeDeg",
	"fixedOrbit",
	"targetTemperatureK",
	"oceanDepthM",
	"landAlbedo",
	"oceanAlbedo",
	"snowIceAlbedo",
	"wetSoil",
	"soilDepthScale",
	"soilWaterCapacityM",
	"soilHeatCapacity",
]

function restrict({ config, previousConfig }: GcmConfigChange): GcmConfig {
	const resolved = GCM_ATMOSPHERE.resolve(config.atmosphere)
	if (resolved.ok === false) throw new Error(resolved.message)
	const previous = GCM_ATMOSPHERE.resolve(previousConfig.atmosphere)
	if (previous.ok === false) throw new Error(previous.message)
	const atmosphere =
		resolved.values.co2Ppm === previous.values.co2Ppm
			? previousConfig.atmosphere
			: GCM_ATMOSPHERE.setFixedCo2Ppm({
					config: previousConfig.atmosphere,
					co2Ppm: resolved.values.co2Ppm,
				})
	return {
		...previousConfig,
		...Object.fromEntries(EDITABLE.map((key) => [key, config[key]])),
		atmosphere: {
			...atmosphere,
			ozone: config.atmosphere.ozone,
		},
	}
}

function changed({ config, previousConfig }: GcmConfigChange): boolean {
	if (EDITABLE.some((key) => config[key] !== previousConfig[key])) return true
	const current = GCM_ATMOSPHERE.resolve(config.atmosphere)
	const previous = GCM_ATMOSPHERE.resolve(previousConfig.atmosphere)
	return (
		!current.ok ||
		!previous.ok ||
		current.values.co2Ppm !== previous.values.co2Ppm ||
		config.atmosphere.ozone !== previousConfig.atmosphere.ozone
	)
}

function fields({
	config,
	previousConfig,
	initial,
}: GcmContinuationFields): Record<string, Float64Array> {
	if (!previousConfig) return {}
	const names: string[] = []
	const currentAtmosphere = GCM_ATMOSPHERE.resolve(config.atmosphere)
	const previousAtmosphere = GCM_ATMOSPHERE.resolve(previousConfig.atmosphere)
	if (
		currentAtmosphere.ok &&
		previousAtmosphere.ok &&
		currentAtmosphere.values.co2Ppm !== previousAtmosphere.values.co2Ppm
	)
		names.push("co2", "dqco2")
	if (config.oceanDepthM !== previousConfig.oceanDepthM)
		names.push("ymld", "xmld", "dmld")
	if (
		config.landAlbedo !== previousConfig.landAlbedo ||
		config.starTemperatureK !== previousConfig.starTemperatureK
	)
		names.push("dalbcl", "dalbcl1", "dalbcl2")
	if (config.soilWaterCapacityM !== previousConfig.soilWaterCapacityM)
		names.push("dwmax")
	return Object.fromEntries(names.map((name) => [name, initial[name]]))
}

export const GCM_CONTINUATION = { EDITABLE, restrict, changed, fields }
