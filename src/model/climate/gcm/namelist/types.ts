export type GcmNamelistFile =
	| "planet_namelist"
	| "plasim_namelist"
	| "radmod_namelist"
	| "landmod_namelist"
	| "vegmod_namelist"
	| "glacier_namelist"
	| "oceanmod_namelist"
	| "seamod_namelist"

export type GcmNamelistEdits = Partial<
	Record<GcmNamelistFile, Record<string, string>>
>

export interface GcmNamelistApplication {
	text: string
	values: Record<string, string>
}
