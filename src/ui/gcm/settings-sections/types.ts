import type { GcmConfig } from "@/model/climate/gcm/types"

export type GcmSettingsSection =
	| "planet"
	| "star"
	| "orbit"
	| "atmosphere"
	| "surface"
	| "model"

export interface GcmSettingsSectionQuery {
	config: GcmConfig
	section: GcmSettingsSection
}

export interface GcmSectionSpec {
	section: GcmSettingsSection
	title: string
	defaultOpen: boolean
}
