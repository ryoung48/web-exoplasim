import type { GcmConfig } from "@/model/climate/gcm/types"

const DEFAULT_CONFIG: GcmConfig = {
	fluxWm2: 1367,
	starTemperatureK: 5780,
	yearDays: 360,
	eccentricity: 0,
	rotationPeriodDays: 1,
	obliquityDeg: 23.5,
	fixedOrbit: true,
	pN2Bar: 0.78,
	pO2Bar: 0.21,
	pArBar: 0.01,
	ozone: true,
	wetSoil: true,
	vegetation: 2,
	initialGrowth: 0.5,
	glaciers: { enabled: true, minDepthM: 2, initialHeightM: -1 },
	physicsFilter: ["gp", "exp", "sp"],
	// ExoPlaSim's Model.configure() default. At T42 PlaSim would choose 30
	// minutes itself ((30 * 64) / NLAT, plasim.f90 near line 1336); 45 needs
	// a third fewer steps per model day. Multi-year T42 stability at 45
	// minutes is unverified; the panel offers 30 if a run aborts.
	timestepMinutes: 45,
	// Radiation every step, as ExoPlaSim does. Every 2 or 3 steps saved 7% or
	// 10% of T42 run time in docs/climate/exoplasim-wasm.md and shifted one-day
	// global mean 2 m temperature by under 0.1 K.
	radiationIntervalSteps: 1,
	// T21 downloads about 4.6 MB and runs a model year in minutes; T42 is
	// opt-in.
	truncation: 21,
	// Keep ExoPlaSim's shipped Earth surface files for the build's resolution (SST and sea-ice
	// climatology, albedo, roughness, soil, vegetation, glaciers) and replace
	// only topography and land fraction. Off follows the Python wrapper's
	// landmap behaviour, which deletes them all and spins up from defaults.
	earthSurfaceClimatology: true,
}

export const GCM = {
	DEFAULT_CONFIG,
}
