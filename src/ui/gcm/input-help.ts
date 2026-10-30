import type { GcmHelpKey } from "@/ui/gcm/types"

export const GCM_INPUT_HELP: Record<GcmHelpKey, string> = {
	layers:
		"How many layers the atmosphere is split into from the ground up. ExoPlaSim's default is 10. Using 5 is faster but coarser, and can change clouds, winds and radiation. The layers follow the terrain rather than sitting at fixed altitudes. Changing this starts a new model; saved runs keep the layer count they were made with.",
	periapseLongitudeDeg:
		"Where in the orbit the planet is closest to its star, given as an angle measured from the northern autumn equinox. It decides which season coincides with closest approach: 0° = northern autumn equinox, 90° = northern winter solstice, 180° = northern spring equinox, 270° = northern summer solstice. To choose it from an orbit's argument of periapsis, use that value minus 90° (add 360° if negative). The default, 102.7°, is Earth's value in ExoPlaSim. This is an angle along the orbit, not a place on the surface. It matters more the more eccentric the orbit is. When Fixed orbit is off, ExoPlaSim's slow orbital changes can move it over time.",
	keplerian:
		"Follows a plain elliptical orbit from your settings and the initial orbital phase, instead of Earth's slow orbital wobble and precession. Off is ExoPlaSim's default. Tidally locked illumination is a separate setting. Initial orbital phase only takes effect when this is on.",
	initialMeanAnomalyDeg:
		"Where the planet starts along its orbit, as an angle that grows steadily with time (0° = closest approach, 180° = half an orbit later). On eccentric orbits this differs from the planet's actual angle around the star. It shifts the starting season and distance from the star, and only applies with Generic Keplerian orbit on. Off keeps ExoPlaSim's own value of −2.9589°.",
	soilWaterCapacityM:
		"The most water the soil can hold, as a depth. Bigger values let the ground keep evaporating between rains and cut down runoff. Off keeps ExoPlaSim's own values. Setting it replaces ExoPlaSim's soil-water map. This is the capacity, not how wet the soil starts out.",
	soilHeatCapacity:
		"How much heat each cubic meter of soil absorbs per degree of warming. Higher values make the ground warm and cool more slowly, which smooths out daily and seasonal swings. Off keeps ExoPlaSim's own value. Applies to soil only; glaciers keep their ice properties.",
	soilDepthScale:
		"Scales the thickness of all five soil layers. At 1×, they are 0.4, 0.8, 1.6, 3.2 and 6.4 m. Thicker soil stores more heat and lets seasonal warmth reach deeper. It does not change soil water capacity, which has its own setting.",
	landAlbedo:
		"How much sunlight bare ground reflects. Higher values mean less sunlight is absorbed, so the surface runs cooler. Off keeps ExoPlaSim's own maps and spectral behavior. Setting it replaces the land-albedo map for both spectral bands; vegetation and snow can still change the effective value.",
	oceanAlbedo:
		"How much sunlight open ocean reflects. Higher values mean less sunlight is absorbed, so the ocean runs cooler. Off keeps ExoPlaSim's own scheme. Setting it applies to both spectral bands; ice-covered water uses the ice settings instead.",
	snowIceAlbedo:
		"How much sunlight snow, glaciers and sea ice reflect. Higher values mean less sunlight is absorbed, which can strengthen ice-driven cooling. Off keeps ExoPlaSim's own temperature-dependent values. The effective reflectivity can still vary with snow cover and surface conditions.",
	truncation:
		"The model's horizontal resolution. T21 uses a 64 × 32 grid, T42 uses 128 × 64, and T63 uses 192 × 96. Higher resolution captures smaller weather and terrain features but takes more computing. T63 needs the GPU engine, and its Earth data is resampled from T42. Smoothing the map for display does not make the model finer.",
	workers:
		"How many browser workers split the calculation. Auto picks a count based on your processor. More workers can be faster but use more memory and CPU, and don't always help. Results may differ very slightly depending on how the work is divided.",
	timestepMinutes:
		"Simulated minutes per step: 5, 10, 15, 20, 30 or 45. Longer steps are faster but less accurate and can become unstable. Extreme pressures may need 5 minutes. The physics itself stays the same.",
	physicsFilter:
		"How the smallest-scale waves are smoothed out. None applies no smoothing. Cesàro, Exp and L-H (Lander–Hoskins) use different damping curves. Smoothing reduces ripples near sharp terrain and day/night edges, but also blurs fine detail. The filter strength is fixed.",
	gridpointFilter:
		"Smooths the changes computed on the map grid before they feed into the circulation calculation, which reduces small-scale noise. Uses the filter chosen above.",
	spectralFilter:
		"Smooths the changes after the circulation calculation as they return to the map grid, which gives a second chance to damp small-scale ripples. Uses the filter chosen above. With None selected, nothing is smoothed.",
	radiusEarth:
		"Planet radius in Earth radii. It sets how large the grid cells are and the scale of weather systems. At the same resolution, a larger planet has larger cells.",
	gravityMs2:
		"Surface gravity. It changes how thick the atmosphere is vertically, how much air sits at a given pressure, and how terrain height translates into the model's geopotential. At the same surface pressure, stronger gravity means less air mass per square meter.",
	fluxWm2:
		"Starlight power arriving at the top of the atmosphere, per square meter facing the star. More flux generally warms the planet; clouds, ice and other feedbacks decide by how much.",
	starTemperatureK:
		"The star's surface temperature. It shifts how its light is split between visible and near-infrared, which the radiation and surface-albedo calculations use. With flux unchanged, total power stays the same and only the color changes.",
	obliquityDeg:
		"The tilt of the planet's spin axis relative to its orbit. 0° is no tilt. More tilt shifts sunlight between latitudes through the year and strengthens the seasons, especially near the poles.",
	eccentricity:
		"How stretched the orbit is; 0 is a circle. Higher values make the distance to the star, and so the incoming energy, vary more over each orbit.",
	rotationPeriodDays:
		"How long one rotation takes, in 24-hour Earth days. Slower rotation weakens the Coriolis effect, which changes winds and large-scale circulation. Tidally locked illumination is a separate setting. A rotation other than one day also changes the model calendar, following ExoPlaSim's convention.",
	yearDays:
		"How long one orbit takes, in 24-hour Earth days; this sets how often the seasons repeat. A model year of exactly 365 days uses real months and leap years; any other length uses a 360-day calendar. When rotation isn't one day, ExoPlaSim counts calendar days by rotation, so a model year can contain a different number of days than the value shown here.",
	synchronous:
		"Keeps the star fixed over one spot, so one side always faces it and the other is always dark. This reshapes temperature, clouds and winds. Rotation is still set separately, and Substellar longitude picks the lit side. The star sits at a latitude equal to the obliquity; in Generic Keplerian mode, a right-ascension correction is also applied.",
	substellarLongitudeDeg:
		"The longitude, measured east from 0°, directly under the fixed star. It decides where the continents and oceans sit relative to the lit side. Only used when Tidally locked illumination is on.",
	fixedOrbit:
		"Keeps eccentricity, obliquity and the other orbit settings constant for the whole run. Turning it off lets PlaSim's slow orbital changes play out. Tidally locked illumination is a separate setting.",
	atmosphereMode:
		"Gas mixture: you enter each gas's partial pressure, and the model adds them up for the total pressure and works out the gas constant from the average molecular weight. Pressure + gas constant: you set those two bulk values directly, and can still add gases within that total. Blank direct inputs use ExoPlaSim's Earth values. With no gases at all, ExoPlaSim defaults to 1.011 bar, about 287 J/(kg·K) and 300 ppm CO₂. Both modes feed the same model settings; the gases you choose don't add new radiation or convection physics.",
	totalPressure:
		"Total surface pressure in bar. In this mode it sets the whole atmosphere, and any gas pressures you enter must fit inside it. Blank uses ExoPlaSim's default of 1.011 bar. Gas mixture mode adds up the gas pressures instead. Below 0.1 bar or above 10 bar you may need a much shorter timestep, possibly 5 minutes.",
	gasConstant:
		"The atmosphere's overall specific gas constant, in J/(kg·K): the molar gas constant divided by the average molar mass (kg/mol). Gas mixture mode works it out from your gases. Here it uses your value, or about 287 (Earth air) if blank. Gas pressures you add do not change it, so enter it yourself when your gas list is incomplete or the atmosphere isn't Earth-like.",
	H2: "Hydrogen partial pressure in bar. It adds to total pressure and lowers the average molecular weight, so a hydrogen-rich mix has a much larger gas constant than Earth air. ExoPlaSim doesn't model how hydrogen- or helium-dominated air with water vapor changes convection and buoyancy. No hydrogen absorption is added.",
	He: "Helium partial pressure in bar. It adds to total pressure and lowers the average molecular weight. ExoPlaSim's Earth-like convection is not accurate for helium- or hydrogen-dominated air with water vapor. No helium absorption is added.",
	N2: "Nitrogen partial pressure in bar. Earth's is about 0.7809 bar. In Gas mixture mode it adds to total pressure and sets the gas constant. Pressure affects air mass, circulation and how widely gases absorb heat. Leave blank to leave nitrogen out; if every gas is blank, ExoPlaSim's own atmosphere is used.",
	O2: "Oxygen partial pressure in bar. Earth's is about 0.2095 bar. It adds to total pressure and the average molecular weight. It does not switch on ozone; use the Ozone toggle for that. Oxygen chemistry is not simulated.",
	Ar: "Argon partial pressure in bar. Earth's is about 0.0093 bar. In Gas mixture mode it adds to total pressure and the average molecular weight. No argon greenhouse absorption is added.",
	Ne: "Neon partial pressure in bar. It adds to total pressure and the average molecular weight, and so to the gas constant in Gas mixture mode. No neon absorption is added.",
	Kr: "Krypton partial pressure in bar. Being heavy, it lowers the mixture's gas constant. It adds to total pressure and the average molecular weight. No krypton absorption is added.",
	CO2: "Carbon dioxide partial pressure in bar. The model divides it by total surface pressure to get CO₂ in ppm; at 1 bar, 0.0003 bar is 300 ppm. Blank keeps ExoPlaSim's 300 ppm; entering 0 means no CO₂. CO₂ drives greenhouse warming and pressure broadening, but very CO₂-rich atmospheres are beyond what ExoPlaSim's radiation scheme handles well.",
	H2O: "Water-vapor partial pressure in bar. It only affects the total pressure and gas constant. It does not set humidity, add water to the water cycle, or set water-vapor greenhouse warming; the model's own water cycle controls those. Leave blank unless you specifically want to adjust the bulk composition.",
	ozone:
		"Adds ExoPlaSim's fixed ozone layer, which changes how the atmosphere absorbs and heats. On by default. It suits oxygen-rich, Earth-like planets around Sun-like stars, but is tuned to Earth and may be wrong for other atmospheres or stars. Setting oxygen does not turn it on, and ozone chemistry is not simulated.",
	oceanDepthM:
		"Depth of the ocean's mixed layer. Deeper water stores more heat, so temperatures change more slowly and seasons are milder. Shallower water reacts faster. This sets heat storage only; there is no deep-ocean circulation.",
	earthSurfaceClimatology:
		"Keeps ExoPlaSim's Earth data (sea-surface temperature, sea ice, albedo, roughness, soil, vegetation and glaciers) but replaces terrain and land fraction with yours. Turning it off uses the model's defaults instead, which may need a different spin-up time.",
	stormclim:
		"Compute tropical cyclone environment diagnostics every model step: CAPE, potential intensity, entropy deficit, vorticity, ventilation and genesis potential. Adds computation on CPU and GPU. Does not simulate or capture individual storms.",
	wetSoil:
		"Makes bare-soil reflectivity depend on soil moisture: dry soil is brighter and wet soil is darker. It stays enabled when Star temperature is set. This changes albedo, not whether soil can hold water or evaporate.",
	glaciers:
		"Lets land glaciers grow where snow persists and shrink as it melts, over model years. This tracks glacier cover only; ice does not flow.",
	vegetation:
		"Off: no vegetation. Diagnostic: vegetation is calculated but doesn't affect the climate. Coupled: vegetation also changes albedo, roughness and soil water capacity, so it feeds back on the climate.",
	initialGrowth:
		"How much vegetation growth a new run starts with. Higher values start with more. Diagnostic or Coupled vegetation then evolves from there. This is not a fixed percentage of forest cover.",
	heightmap:
		"A 2:1 world elevation map. Values at or below the sea-level shade are flattened to zero; brighter values scale up to the maximum elevation.",
	landMask:
		"Optional PNG the same size as the heightmap. White or bright pixels are land and black or dark pixels are ocean. Without one, pixels brighter than the sea-level shade are land.",
	invertMask: "Swaps land and ocean in the mask. Elevations are unchanged.",
	maxElevation:
		"Elevation assigned to the brightest pixel in a PNG or the highest sample in a binary file. Values above the sea-level shade scale linearly up to this height.",
	seaLevel:
		"Grayscale cutoff from 0 (black) to 255 (white). Values at or below it have zero elevation. Without a land mask they are ocean; an imported mask controls land and ocean independently.",
}
