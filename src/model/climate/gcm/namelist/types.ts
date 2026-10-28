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

// A namelist file's text (absent when the page writes none) and the
// Fortran defaults its values override; arrays take comma lists.
export interface GcmNamelistRead<T> {
	text: string | undefined
	defaults: T
}

export interface GcmNamelistApplication {
	text: string
	values: Record<string, string>
}
