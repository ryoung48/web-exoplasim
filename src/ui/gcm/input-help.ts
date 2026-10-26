import type { GcmHelpKey } from "@/ui/gcm/types"

export const GCM_INPUT_HELP: Record<GcmHelpKey, string> = {
	layers:
		"Number of atmospheric layers actually simulated. ExoPlaSim defaults to 10. Five layers reduce vertical resolution and computation, but can change clouds, circulation and radiation. The speed improvement depends on resolution and device. These are terrain-following sigma layers, not fixed altitudes. Changing this starts a new model; saved runs retain their original layer count.",
	periapseLongitudeDeg:
		"Angle along the orbit of periapsis, the point closest to the star, measured in degrees from the northern autumnal equinox. It orients the planet's rotational axis relative to its orbit and sets how closest approach aligns with the seasons: 0° = northern autumn equinox; 90° = northern winter solstice; 180° = northern spring equinox; 270° = northern summer solstice. Set this to the argument of obliquity minus 90°, adding 360° if the result is negative. Off preserves ExoPlaSim's native Earth value of 102.7°. This is an orbital angle, not a surface longitude. Its seasonal effect grows with eccentricity. In the standard orbit scheme, long-term orbital variations can change it when Fixed orbit is off.",
	keplerian:
		"Uses ExoPlaSim's generic Keplerian orbit calculation. It follows the selected elliptical orbit and initial mean anomaly instead of calculating Earth's long-term orbital variations and precession. Off is the upstream default. Tidally locked illumination remains a separate setting. Initial orbital phase applies only in this mode.",
	initialMeanAnomalyDeg:
		"Initial mean anomaly: the orbit's time-based phase angle, increasing uniformly through the orbital period. Zero marks periapse at the scheme's phase origin; 180° is half an orbit later. For eccentric orbits this differs from the geometric angle along the orbit. It shifts the starting seasonal and stellar-distance pattern in generic Keplerian mode. Off preserves ExoPlaSim's native -2.9589° value.",
	soilWaterCapacityM:
		"Maximum water depth the soil can store. More storage can sustain evaporation between rain events and reduce overflow runoff. Off preserves ExoPlaSim's native settings. An explicit override follows upstream's soilwatercap option and removes its prescribed soil-water surface file. It sets capacity, not initial saturation.",
	soilHeatCapacity:
		"Heat stored per cubic meter of soil for each degree of warming. Higher values slow ground warming and cooling, changing daily and seasonal temperature swings. Off preserves ExoPlaSim's native heat capacity. The setting applies to soil; glaciers retain their ice properties.",
	soilDepthScale:
		"Multiplier for ExoPlaSim's five soil-layer thicknesses: 0.4, 0.8, 1.6, 3.2 and 6.4 meters at the native default of 1×. Deeper layers store more heat and change how seasonal heating penetrates the ground. This does not scale the separate soil-water capacity setting.",
	landAlbedo:
		"Fraction of sunlight reflected by bare ground. Higher albedo generally reduces absorbed sunlight and cools the surface. Off preserves ExoPlaSim's native surface maps and spectral behavior. An override replaces the land-albedo map and sets both ground spectral bands; vegetation and snow can still change effective albedo.",
	oceanAlbedo:
		"Fraction of sunlight reflected by open ocean. Higher values reduce absorbed sunlight and generally cool the ocean. Off preserves ExoPlaSim's native ocean-albedo scheme. An override sets the ocean albedo and both spectral bands; ice-covered water uses the ice scheme.",
	snowIceAlbedo:
		"Reflectivity settings for snow, glaciers and sea ice. Higher values generally reduce sunlight absorbed by frozen surfaces and can strengthen ice cooling feedbacks. Off preserves ExoPlaSim's native temperature-dependent and spectral settings. The override follows upstream's snowicealbedo option; effective reflectivity can still depend on surface state and snow cover.",
	truncation:
		"Horizontal model resolution. T21 uses 64 × 32 grid cells; T42 uses 128 × 64 and resolves smaller weather and terrain features. T42 downloads more data and requires substantially more computation. Downscaled display maps do not increase the model's resolution.",
	workers:
		"Number of browser workers sharing the model calculation. Auto chooses from the available builds using your processor's reported concurrency. More workers can run faster, but also use more memory and CPU; speed does not always improve. Small numerical differences can arise from summation order.",
	timestepMinutes:
		"Simulated minutes advanced by each integration step. The available choices are 5, 10, 15, 30 and 45 minutes. Larger steps need fewer calculations but can reduce numerical accuracy or stability; pressure extremes may require steps as short as 5 minutes. The simulated physical processes remain the same.",
	radiationIntervalSteps:
		"How often the model recalculates radiation. Every 2 or 3 steps reuses the previous radiative fluxes and heating between updates. This can speed up a run, but responds less frequently to changing sunlight, clouds and temperature.",
	physicsFilter:
		"Chooses how the shortest spatial waves are smoothed. None disables smoothing; Cesàro, exponential and Lander–Hoskins use different damping profiles. Filtering can reduce ringing near sharp terrain or day/night boundaries, while smoothing small-scale detail. The port uses fixed filter-strength parameters.",
	gridpointFilter:
		"Applies the selected physics filter during the transformation from latitude–longitude gridpoint tendencies into spectral coefficients. This can suppress small-scale noise before those tendencies enter the circulation calculation.",
	spectralFilter:
		"Applies the selected physics filter during the transformation from spectral tendencies back to the latitude–longitude grid. It provides another place to damp small-scale ringing. With the smoothing method set to None, there is no filter damping.",
	radiusEarth:
		"Planet radius measured in Earth radii. It changes the physical distances represented by the model grid and the length scales of atmospheric dynamics. At the same grid resolution, a larger planet has larger cells in kilometers.",
	gravityMs2:
		"Surface gravitational acceleration. It affects atmospheric scale height, the mass of air at a given pressure, and how terrain elevation becomes geopotential. At the same surface pressure, stronger gravity means less atmospheric mass per unit area.",
	fluxWm2:
		"Incoming stellar power per square meter at the top of the atmosphere, before averaging over the planet. Increasing it adds energy and generally warms the climate; clouds, ice and other feedbacks determine the response.",
	starTemperatureK:
		"The star's effective blackbody temperature. It changes the visible/near-infrared weighting used by the radiation and surface-albedo scheme. With stellar flux held fixed, this changes the spectrum rather than total incoming power. A nonzero star temperature overrides Wet soil.",
	obliquityDeg:
		"Tilt of the spin axis away from the orbital normal. Zero means no axial tilt. Increasing tilt changes how sunlight moves between latitudes through the year and generally increases seasonal contrasts, particularly near the poles.",
	eccentricity:
		"How elliptical the orbit is; zero is circular. Higher eccentricity produces larger changes in stellar distance and incoming energy during an orbit, changing seasonal heating.",
	rotationPeriodDays:
		"Time for one rotation, in 24-hour Earth days. Slower rotation weakens the Coriolis effect and changes winds and large-scale circulation. The fixed-star illumination switch is separate. Non-one-day rotation also changes the model calendar using ExoPlaSim's rotation-based day-count convention.",
	yearDays:
		"Orbital period in 24-hour Earth days, controlling how quickly the seasonal cycle repeats. When rotation differs from one day, the port follows ExoPlaSim's convention of deriving the model calendar's day count from rotation; a displayed model year can therefore have a different number of model days.",
	synchronous:
		"Keeps the star at a fixed longitude, producing a persistent day/night heating pattern. This can reorganize temperature, clouds and circulation. Rotation remains separately controlled; Substellar longitude chooses the illuminated side.",
	substellarLongitudeDeg:
		"Longitude, measured eastward from 0°, beneath the fixed star. It places the center of the illuminated side relative to your continents and oceans. It only affects the model when Tidally locked illumination is enabled.",
	fixedOrbit:
		"Keeps orbital parameters such as eccentricity and obliquity fixed throughout the run. Turning it off allows PlaSim's long-term orbital variations. This controls changes in the orbit over time; fixed stellar longitude is a separate setting.",
	atmosphereMode:
		"Gas mixture calculates total surface pressure from the supplied gas partial pressures and derives the effective gas constant from their mean molar mass. Pressure + gas constant lets you set those bulk quantities directly and optionally specify gases within that total. Blank direct inputs use native Earth values. With no gases supplied, the pinned ExoPlaSim wrapper defaults to 1.011 bar, approximately 287 J/(kg·K), and 300 ppm CO₂. These modes configure the same native model parameters; gas choices do not add new radiation or convection schemes.",
	totalPressure:
		"Total surface pressure in bars. In direct mode this sets the whole atmosphere, and supplied gas partial pressures must fit inside it. Blank uses the pinned ExoPlaSim default of 1.011 bar. Gas mixture mode instead sums the component pressures. Below 0.1 bar or above 10 bar, significantly shorter timesteps may be needed, potentially 5 minutes.",
	gasConstant:
		"Effective specific gas constant for the entire atmosphere, in J/(kg·K). It is the molar gas constant divided by mean molar mass in kg/mol. Gas mixture mode derives it from the supplied partial pressures. Direct mode uses your value, or approximately 287 for native Earth air if blank; optional partial pressures do not replace this bulk value. Set it explicitly when an incomplete gas list describes a non-Earthlike atmosphere.",
	H2: "Partial pressure of hydrogen in bars. It contributes to atmospheric mass, total pressure and mean molar mass; a hydrogen-rich mixture has a much larger gas constant than Earth air. ExoPlaSim does not fully model the altered convection and buoyancy of hydrogen/helium-dominated atmospheres containing water vapor. Bulk gas configuration does not add hydrogen absorption physics.",
	He: "Partial pressure of helium in bars. It contributes to the bulk mixture and lowers mean molar mass. ExoPlaSim's Earthlike convection assumptions limit its accuracy for helium/hydrogen-dominated atmospheres with water vapor. This input does not add a helium radiation scheme.",
	N2: "Partial pressure of nitrogen in bars. Earth's reference value is about 0.7809 bar. In Gas mixture mode it contributes to total pressure and the effective gas constant. Pressure affects atmospheric mass, circulation and radiative pressure broadening. Leave blank to omit a specified nitrogen component; all blank gas inputs preserve the native atmosphere.",
	O2: "Partial pressure of oxygen in bars. Earth's reference value is about 0.2095 bar. It contributes to the bulk mixture's pressure and mean molar mass. The Ozone toggle is separate: setting oxygen does not automatically create an ozone layer or simulate oxygen photochemistry.",
	Ar: "Partial pressure of argon in bars. Earth's reference value is about 0.0093 bar. It contributes to total pressure and mean molar mass in Gas mixture mode. It does not add an argon greenhouse absorption scheme.",
	Ne: "Partial pressure of neon in bars. It contributes to bulk atmospheric pressure and mean molar mass, and therefore to the calculated gas constant in Gas mixture mode. No neon-specific radiation scheme is added.",
	Kr: "Partial pressure of krypton in bars. Its comparatively high molar mass can lower the mixture's gas constant. It contributes to bulk pressure and molecular weight, without adding krypton-specific absorption physics.",
	CO2: "Partial pressure of carbon dioxide in bars. The model uses this divided by total surface pressure to set its radiatively active CO₂ concentration in ppm. At 1 bar, 0.0003 bar is 300 ppm. Blank preserves ExoPlaSim's native 300 ppm; an explicit zero sends zero CO₂. CO₂ affects greenhouse absorption and pressure broadening; high-CO₂ atmospheres remain limited by the native radiation scheme.",
	H2O: "Specified water-vapor partial pressure in bars affects only bulk surface pressure and the mixture's gas constant. It does not initialize humidity, add water to the hydrological cycle, or directly set water-vapor greenhouse absorption. Those remain controlled by the model's prognostic water cycle. Leave blank unless you intend this bulk-composition adjustment.",
	ozone:
		"Adds ExoPlaSim's prescribed ozone layer, changing atmospheric absorption and heating. It defaults off in the pinned wrapper. Ozone can be relevant to oxygen-rich Earthlike planets around Sunlike stars, but its parameterization is Earth-tuned and may be inaccurate for other atmospheres or stellar spectra. Oxygen partial pressure does not automatically enable it; the model does not calculate ozone photochemistry.",
	oceanDepthM:
		"Depth of the slab ocean’s mixed layer. Deeper water stores more heat, slowing temperature changes and usually moderating seasonal swings. Shallower water responds faster. This controls ocean heat storage rather than a dynamic deep-ocean circulation.",
	earthSurfaceClimatology:
		"Retains the bundled Earth surface files, including sea-surface temperature and ice climatologies, albedo, roughness, soil, vegetation and glaciers, while replacing terrain and land fraction. These affect surface initialization and boundary conditions. Off uses model defaults for those properties, which can require a different spin-up.",
	wetSoil:
		"Makes land albedo depend on soil moisture: wetter soil becomes darker and can absorb more sunlight. ExoPlaSim disables this broadband effect when a nonzero star temperature selects spectral albedo, so that setting overrides this toggle. ExoPlaSim turns wet soil off when a star temperature is set (two-band albedo).",
	glaciers:
		"Allows the model's land-glaciation tracking to respond to persistent snow. Glacier coverage can change over model years as snow persists or melts, affecting the surface's snow and ice conditions. It does not provide an ice-flow simulation.",
	vegetation:
		"Off disables vegetation calculations. Diagnostic computes vegetation without feeding it back into surface properties. Coupled also changes properties such as albedo, roughness and soil-water capacity, allowing vegetation to affect the climate.",
	initialGrowth:
		"Initial above-ground vegetation growth parameter for a fresh run. Higher values start the vegetation module with more growth. Diagnostic or coupled vegetation then evolves from that starting condition; this is not a fixed forest-cover percentage.",
	heightmap:
		"A global 2:1 elevation map. PNG brightness is mapped through Black and White elevation; a Chaos binary already contains elevations in meters. Terrain is regridded to the model and affects airflow, mountain precipitation and surface geopotential.",
	landMask:
		"Optional PNG with the same dimensions as the heightmap. White or bright pixels are land; black or dark pixels are ocean. It sets land independently of elevation, changing land/ocean heat storage and water exchange. Without a mask, positive elevation above the selected sea level is land.",
	invertMask:
		"Reverses which mask pixels mean land and ocean. Use this when the supplied mask uses dark land and bright ocean. It changes land classification without changing the elevation values.",
	blackElevation:
		"Elevation assigned to black PNG pixels. Intermediate brightness is interpolated between Black and White elevation, changing the terrain's heights and relief. White elevation must be higher than Black elevation. Binary heightmaps already contain elevations and do not use this mapping.",
	whiteElevation:
		"Elevation assigned to white PNG pixels. Raising it increases the height of brighter terrain and changes relief, which influences circulation and mountain precipitation. White elevation must remain above Black elevation.",
	seaLevel:
		"Reference elevation subtracted from every heightmap value. Raising it lowers terrain relative to sea level and, without a separate mask, turns more pixels into ocean. With a mask, land classification stays fixed but the elevations still shift.",
}
