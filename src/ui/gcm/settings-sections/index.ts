import { GCM } from "@/model/climate/gcm"
import type { GcmConfig } from "@/model/climate/gcm/types"
import type {
	GcmSettingsSection,
	GcmSettingsSectionQuery,
} from "@/ui/gcm/settings-sections/types"

const SECTION_KEYS: Record<
	GcmSettingsSection,
	ReadonlyArray<keyof GcmConfig>
> = {
	planet: ["radiusEarth", "gravityMs2"],
	star: ["fluxWm2", "starTemperatureK"],
	orbit: [
		"obliquityDeg",
		"eccentricity",
		"rotationPeriodDays",
		"yearDays",
		"synchronous",
		"substellarLongitudeDeg",
		"keplerian",
		"periapseLongitudeDeg",
		"initialMeanAnomalyDeg",
		"fixedOrbit",
	],
	atmosphere: ["atmosphere"],
	surface: [
		"oceanDepthM",
		"vegetation",
		"initialGrowth",
		"wetSoil",
		"glaciers",
		"earthSurfaceClimatology",
		"soilDepthScale",
		"landAlbedo",
		"oceanAlbedo",
		"snowIceAlbedo",
		"soilWaterCapacityM",
		"soilHeatCapacity",
	],
	model: ["truncation", "layers", "timestepMinutes", "physicsFilter"],
}

function comparable(value: unknown): string {
	return JSON.stringify(Array.isArray(value) ? [...value].sort() : value)
}

function modified({ config, section }: GcmSettingsSectionQuery): boolean {
	return SECTION_KEYS[section].some(
		(key) => comparable(config[key]) !== comparable(GCM.DEFAULT_CONFIG[key]),
	)
}

function reset({ config, section }: GcmSettingsSectionQuery): GcmConfig {
	return SECTION_KEYS[section].reduce<GcmConfig>(
		(next, key) => ({ ...next, [key]: GCM.DEFAULT_CONFIG[key] }),
		config,
	)
}

export const GCM_SETTINGS_SECTIONS = {
	modified,
	reset,
}
