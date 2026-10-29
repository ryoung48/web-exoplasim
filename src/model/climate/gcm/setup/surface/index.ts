import { CALENDAR } from "@/model/climate/gcm/calendar"
import { FOURIER } from "@/model/climate/gcm/fourier"
import { GCM_GRID } from "@/model/climate/gcm/grid"
import { LEGENDRE } from "@/model/climate/gcm/legendre"
import { MODULE_SETUP } from "@/model/climate/gcm/setup/modules"
import type { GcmModuleSetupRequest } from "@/model/climate/gcm/setup/modules/types"
import { PUMAMOD } from "@/model/climate/gcm/setup/pumamod"
import type {
	GcmExtremeRequest,
	GcmGlacierAlbedo,
	GcmIceThicknessRequest,
	GcmMonthlyValue,
	GcmRunoff,
	GcmRunoffRate,
	GcmRunoffRequest,
	GcmSaturationRequest,
	GcmSurfaceField,
	GcmSurfaceRead,
	GcmSurfaceState,
	GcmWetSoilAlbedo,
} from "@/model/climate/gcm/setup/surface/types"

const MONTHS = CALENDAR.CLIMATOLOGY_MONTHS
// landmod's unset-surface sentinel and soil layers.
const UNSET = 1e20
const SOIL_LAYERS = 5
// roffini/oroini: runoff speed scale (m/s) and slope exponent.
const RUNOFF_SPEED = 4.2
const RUNOFF_EXPONENT = 0.18
// oroini: gravitational constant, Earth's mass (kg) and radius (m), with
// which glacier height becomes geopotential.
const GRAVITY_CONSTANT = 6.67408e-11
const EARTH_MASS = 5.9722e24
const EARTH_RADIUS = 6.371e6
const GLACIER_DENSITY = 850
// plasimmod's orography scaling, which only p_mars.f90 changes.
const OROSCALE = 1
// make_ice_thickness (CCM3): compactness and thickness (m) bounds per
// hemisphere and the northern monthly thickness factor.
const ICE_NORTH = { cmin: 0.1, cmax: 0.9, hmin: 0.25, hmax: 3 }
const ICE_SOUTH = { cmin: 0.25, hmin: 0.25, hmax: 0.5 }
const ICE_MONTH_FACTOR = [
	0.912, 0.942, 1, 1.058, 1.124, 1.161, 1.175, 1.058, 0.931, 0.883, 0.88, 0.876,
	0.912, 0.942,
]

// surface_ini's codes for the fields surfini reads (surfmod.f90).
const CODE = {
	LAND_MASK: 172,
	OROGRAPHY: 129,
	ROUGHNESS: 173,
	OROGRAPHIC_ROUGHNESS: 1730,
	GLACIER: 232,
	FOREST: 212,
	FIELD_CAPACITY: 229,
	SOIL_TEMPERATURE: 209,
	ALBEDO: 174,
	ALBEDO_VISIBLE: 175,
	ALBEDO_INFRARED: 176,
	ABOVE_GROUND_GROWTH: 1605,
	STOMATAL_CONDUCTANCE: 1606,
	MAXIMUM_ROUGHNESS: 1607,
	BIOMASS_GROWTH: 1604,
	SURFACE_TEMPERATURE: 169,
	ICE_COVER: 210,
	ICE_THICKNESS: 211,
}
// Every code except the page's own orography and land mask.
const CLIMATOLOGY_CODES = Object.values(CODE).filter(
	(code) => code !== CODE.OROGRAPHY && code !== CODE.LAND_MASK,
)

// get_surf_array: N<NLAT>_surf_<code>.sra, each record an 8-integer header
// and NUGP values. Climatologies of 12 months gain December before and
// January after; a single field fills all 14.
function read({
	files,
	code,
	grid,
	months,
}: GcmSurfaceRead): Float64Array | null {
	const name = `N${String(grid.latitudes).padStart(3, "0")}_surf_${String(code).padStart(4, "0")}.sra`
	const text = files[name]
	if (text === undefined) return null
	const tokens = text.trim().split(/\s+/).map(Number)
	const record = 8 + grid.points
	const found = Math.min(months, Math.floor(tokens.length / record))
	const result = new Float64Array(months * grid.points)
	for (let month = 0; month < found; month++)
		result.set(
			tokens.slice(month * record + 8, (month + 1) * record),
			month * grid.points,
		)
	if (found === months) return result
	const at = (month: number) =>
		result.subarray(month * grid.points, (month + 1) * grid.points)
	if (found === 12 && months === MONTHS) {
		for (let month = 12; month >= 1; month--) at(month).set(at(month - 1))
		at(13).set(at(1))
		at(0).set(at(12))
	} else if (found === 1 && months === MONTHS) {
		for (let month = 1; month < MONTHS; month++) at(month).set(at(0))
	} else {
		throw new Error(`${name} has ${found} fields, expected ${months}`)
	}
	return result
}

// momint's linear interpolation of a 14-month climatology to a step.
function monthly({
	table,
	step,
	pumamod,
	points,
}: GcmMonthlyValue): Float64Array {
	const { month, neighbour, weight } = CALENDAR.monthInterpolation({
		step,
		stepsPerDay: pumamod.ntspd,
		daysPerYear: pumamod.n_days_per_year,
		daysPerMonth: pumamod.n_days_per_month,
		stepMinutes: pumamod.mpstep,
		solarDay: pumamod.solar_day,
	})
	return Float64Array.from(
		{ length: points },
		(_, h) =>
			(1 - weight) * table[month * points + h] +
			weight * table[neighbour * points + h],
	)
}

function extreme({ values, sign }: GcmExtremeRequest): number {
	return values.reduce(
		(best, value) => (sign * value > sign * best ? value : best),
		values[0],
	)
}

function runoffRate({ slope, spacing, sign }: GcmRunoffRate): number {
	return ((sign * RUNOFF_SPEED) / spacing) * Math.abs(slope) ** RUNOFF_EXPONENT
}

function glacierAlbedo({ max, min, ts, tmelt }: GcmGlacierAlbedo): number {
	return Math.max(
		min,
		Math.min(max, max - ((max - min) * (ts - 263.16)) / (tmelt - 263.16)),
	)
}

// getalb: wetter soil is darker, from the dry maximum towards the ocean's
// albedo (shape parameters aa = 5.2, yy = 4).
function wetSoilAlbedo({ bf, dry, ocean }: GcmWetSoilAlbedo): number {
	const aa = 5.2
	const yy = 4
	const al = (1 / aa) * (Math.max(bf, 1e-3) ** ((1 - yy) / yy) - 1) ** (1 / yy)
	const dryWeight = Math.exp(-((bf * 25) ** 6))
	const wetWeight = Math.exp(-(((1 - bf) * 30) ** 9))
	return dry * dryWeight + al * (1 - dryWeight - wetWeight) + ocean * wetWeight
}

// Saturation specific humidity at the namelist psurf (Magnus–Tetens).
function saturation({ temperature, pumamod }: GcmSaturationRequest): number {
	const { rdbrv, ra1, ra2, ra4, tmelt, psurf } = pumamod
	const q =
		(rdbrv *
			ra1 *
			Math.exp((ra2 * (temperature - tmelt)) / (temperature - ra4))) /
		psurf
	return q / (1 - (1 / rdbrv - 1) * q)
}

// oroini's river directions: raise every land minimum above its lowest
// neighbour until none is left, then runoff velocities down the slopes.
function runoff({
	orography,
	mask,
	grid,
	pumamod,
}: GcmRunoffRequest): GcmRunoff {
	const { longitudes: nlon, latitudes: nlat, points } = grid
	const duroff = new Float64Array(points)
	const dvroff = new Float64Array(points)
	let height = Float64Array.from(orography, (value, h) =>
		mask[h] < 1 ? mask[h] - 1 : Math.max(value, 0),
	)
	if (
		(extreme({ values: height, sign: 1 }) -
			extreme({ values: height, sign: -1 })) /
			pumamod.ga <=
		0.01
	)
		return { duroff, dvroff }
	const neighbours = (h: number) => {
		const lon = h % nlon
		const lat = (h - lon) / nlon
		const around = [
			lat * nlon + ((lon + 1) % nlon),
			lat * nlon + ((lon + nlon - 1) % nlon),
		]
		if (lat > 0) around.push(h - nlon)
		if (lat < nlat - 1) around.push(h + nlon)
		return around.map((at) => height[at])
	}
	let raised = true
	while (raised) {
		raised = false
		const next = new Float64Array(points)
		for (let h = 0; h < points; h++) {
			const around = neighbours(h)
			if (mask[h] > 0 && around.every((value) => height[h] <= value)) {
				next[h] = 1 + Math.min(...around)
				raised = true
			} else next[h] = height[h]
		}
		height = next
	}
	const twopi = PUMAMOD.TWOPI
	for (let lat = 0; lat < nlat; lat++) {
		const dx =
			(twopi * Math.cos(Math.asin(grid.latitudeSines[lat])) * pumamod.plarad) /
			nlon
		for (let lon = 0; lon < nlon; lon++) {
			const h = lat * nlon + lon
			const slope = (height[lat * nlon + ((lon + 1) % nlon)] - height[h]) / dx
			duroff[h] = runoffRate({ slope, spacing: dx, sign: slope > 0 ? -1 : 1 })
		}
	}
	for (let lat = 0; lat < nlat - 1; lat++) {
		const dy =
			(Math.asin(grid.latitudeSines[lat + 1]) -
				Math.asin(grid.latitudeSines[lat])) *
			pumamod.plarad
		for (let lon = 0; lon < nlon; lon++) {
			const h = lat * nlon + lon
			const slope = (height[h + nlon] - height[h]) / dy
			dvroff[h] = runoffRate({ slope, spacing: dy, sign: slope < 0 ? -1 : 1 })
		}
	}
	return { duroff, dvroff }
}

// make_ice_thickness: monthly ice thickness (m) from ice cover.
function iceThickness({ cover, grid }: GcmIceThicknessRequest): Float64Array {
	const { points, longitudes } = grid
	const thickness = new Float64Array(cover.length)
	for (let month = 0; month < MONTHS; month++)
		for (let h = 0; h < points; h++) {
			const c = cover[month * points + h]
			const north = Math.floor(h / longitudes) < grid.latitudes / 2
			let d = 0
			if (north) {
				const { cmin, cmax, hmin, hmax } = ICE_NORTH
				const factor = ICE_MONTH_FACTOR[month]
				if (c >= cmax) d = hmax * factor
				else if (c >= cmin)
					d = (hmin + ((hmax - hmin) * (c - cmin)) / (cmax - cmin)) * factor
				else if (c > 0) d = hmin * factor
			} else if (c >= ICE_SOUTH.cmin) d = ICE_SOUTH.hmax
			else if (c > 0) d = ICE_SOUTH.hmin + c
			thickness[month * points + h] = d
		}
	return thickness
}

// surfini (landini, glacierini, vegini, seaini with iceini and oceanini)
// and radini's CO2 field, for a fresh start from the page's .sra files.
function initial(module: GcmModuleSetupRequest): GcmSurfaceState {
	const { request, pumamod } = module
	const grid = GCM_GRID.forLatitudes(PUMAMOD.latitudes(request.truncation))
	const { points, longitudes } = grid
	const files = request.namelists
	const field = ({ code, fallback }: GcmSurfaceField) =>
		read({ files, code, grid, months: 1 }) ??
		new Float64Array(points).fill(fallback)
	const climatology = ({ code, fallback }: GcmSurfaceField) =>
		read({ files, code, grid, months: MONTHS }) ??
		new Float64Array(MONTHS * points).fill(fallback)
	const rad = MODULE_SETUP.radmod(module)
	const land = MODULE_SETUP.landmod({ ...module, albedos: rad.albedos })
	const sea = MODULE_SETUP.seamod({ ...module, albedos: rad.albedos })
	const ice = MODULE_SETUP.icemod(module)
	const veg = MODULE_SETUP.vegmod(module)
	const ocean = MODULE_SETUP.oceanmod(module)
	const surf = MODULE_SETUP.surfmod(module)
	const glacier = MODULE_SETUP.glaciermod(module)
	const { tmelt, n_start_step: step } = pumamod
	const zero = () => new Float64Array(points)
	const rowWeights = Float64Array.from(
		{ length: points },
		(_, h) => grid.latitudeWeights[Math.floor(h / longitudes)],
	)

	// landini
	const dls = field({ code: CODE.LAND_MASK, fallback: 1 }).map((value) =>
		value > 0.5 ? 1 : 0,
	)
	const orography = field({ code: CODE.OROGRAPHY, fallback: 0 })
	const dz0clim = field({ code: CODE.ROUGHNESS, fallback: land.dz0land })
	const dz0climo = field({ code: CODE.OROGRAPHIC_ROUGHNESS, fallback: 0 })
	const dglac = field({ code: CODE.GLACIER, fallback: 0 })
	if (land.dzglac > 0)
		dglac.forEach((_, h) => {
			if (orography[h] > land.dzglac * pumamod.ga) dglac[h] = 1
		})
	dglac.forEach((value, h) => {
		dglac[h] = value > 0.5 ? 1 : 0
	})
	const dforest = field({ code: CODE.FOREST, fallback: land.rinifor })
	const dwmax = field({ code: CODE.FIELD_CAPACITY, fallback: land.wsmax }).map(
		(value) => Math.max(value, 0),
	)
	const dtclsoil = field({ code: CODE.SOIL_TEMPERATURE, fallback: tmelt })
	const dalbcl = climatology({ code: CODE.ALBEDO, fallback: land.albland })
	const dalbcl1 = climatology({
		code: CODE.ALBEDO_VISIBLE,
		fallback: land.dgroundalb[0],
	})
	const dalbcl2 = climatology({
		code: CODE.ALBEDO_INFRARED,
		fallback: land.dgroundalb[1],
	})
	const landDts = new Float64Array(points).fill(UNSET)
	const landDtsm = new Float64Array(points).fill(UNSET)
	const landDqs = new Float64Array(points).fill(UNSET)
	const dsoilt = new Float64Array(SOIL_LAYERS * points).fill(tmelt)
	const dsnowt = new Float64Array(points).fill(tmelt)
	const dsnowz = zero()
	const dwatc = zero()
	for (let h = 0; h < points; h++) {
		if (dls[h] <= 0) continue
		landDts[h] = dtclsoil[h]
		for (let l = 0; l < SOIL_LAYERS; l++) dsoilt[l * points + h] = landDts[h]
		dwatc[h] =
			land.nwatcini > 0
				? land.dwatcini
				: land.drhsland * land.drhsfull * dwmax[h]
	}
	const dalbclim = monthly({ table: dalbcl, step: step + 1, pumamod, points })
	const dalbclim1 = monthly({ table: dalbcl1, step: step + 1, pumamod, points })
	const dalbclim2 = monthly({ table: dalbcl2, step: step + 1, pumamod, points })
	if (land.nwetsoil > 0.5)
		for (let h = 0; h < points; h++) {
			if (dls[h] <= 0.5) continue
			if (landDts[h] > 273.15) {
				// dwater is zero at a fresh start.
				const bf = 0 / land.wsmax
				dalbclim[h] = wetSoilAlbedo({
					bf,
					dry: land.alblandmax,
					ocean: sea.doceanalb[0],
				})
				dalbclim1[h] = dalbclim[h]
				dalbclim2[h] = wetSoilAlbedo({
					bf,
					dry: land.alblandmax,
					ocean: sea.doceanalb[1],
				})
			} else {
				dalbclim[h] = land.albland
				dalbclim1[h] = land.dgroundalb[0]
				dalbclim2[h] = land.dgroundalb[1]
			}
		}
	const dalb = zero()
	const dsalb = new Float64Array(2 * points)
	const drhs = zero()
	const dz0 = zero()
	const dsnow = zero()
	const soil = [zero(), zero(), zero(), zero(), zero()]
	const dt = new Float64Array((request.levels + 1) * points)
	const dq = new Float64Array((request.levels + 1) * points)
	const surfaceLevel = request.levels * points
	for (let h = 0; h < points; h++) {
		if (dls[h] <= 0) continue
		const ts = landDts[h]
		landDtsm[h] = ts
		landDqs[h] = saturation({ temperature: ts, pumamod })
		dsnow[h] = dsnowz[h]
		dalb[h] = dalbclim[h]
		dsalb[h] = dalbclim1[h]
		dsalb[points + h] = dalbclim2[h]
		if (dwmax[h] > 0)
			drhs[h] = Math.min(1, dwatc[h] / (land.drhsfull * dwmax[h]))
		dz0[h] = dz0clim[h]
		for (let l = 0; l < SOIL_LAYERS; l++) soil[l][h] = dsoilt[l * points + h]
		if (dglac[h] > 0.5) {
			dsnowz[h] = Math.max(land.dsmax, 0)
			dsnow[h] = dsnowz[h]
			dalb[h] = glacierAlbedo({
				max: land.albgmax,
				min: land.albgmin,
				ts,
				tmelt,
			})
			dsalb[h] = glacierAlbedo({
				max: land.albgmax1,
				min: land.albgmin1,
				ts,
				tmelt,
			})
			dsalb[points + h] = glacierAlbedo({
				max: land.albgmax2,
				min: land.albgmin2,
				ts,
				tmelt,
			})
			drhs[h] = 1
		}
		dt[surfaceLevel + h] = ts
		dq[surfaceLevel + h] = landDqs[h]
	}

	// glacierini and oroini: glacier ice raises the orography, rivers follow
	// it, and its spectral transform is so.
	if (glacier.icesheeth >= 0) {
		orography.forEach((ground, h) => {
			const covered = ground !== 0
			dglac[h] = covered ? 1 : 0
			dsnowz[h] = covered ? glacier.icesheeth : 0
		})
	} else
		dsnowz.forEach((value, h) => {
			if (dglac[h] > 0 && value === 0) dsnowz[h] = glacier.glacelim
		})
	let doro = orography.slice()
	if (glacier.nglacier === 1) {
		const gm = GRAVITY_CONSTANT * EARTH_MASS
		doro = Float64Array.from(orography, (raw, h) => {
			const ground = raw * OROSCALE
			const dz =
				(EARTH_RADIUS * EARTH_RADIUS * ground) / (gm - EARTH_RADIUS * ground)
			const snow = dsnowz[h] / (GLACIER_DENSITY / 1000)
			const gravity = gm / ((EARTH_RADIUS + dz) * (EARTH_RADIUS + dz))
			return (
				ground +
				(gravity * snow - (gravity / (dz + EARTH_RADIUS)) * snow * snow)
			)
		})
	}
	const { duroff, dvroff } = runoff({
		orography: doro,
		mask: dls,
		grid,
		pumamod,
	})
	const so = LEGENDRE.analyse({
		fourier: FOURIER.analyse({
			values: doro.map((value) => value * OROSCALE),
			longitudes,
			truncation: request.truncation,
		}),
		qc: LEGENDRE.tables({ grid, truncation: request.truncation }).qc,
		filter: LEGENDRE.filters({
			truncation: request.truncation,
			nfilter: pumamod.nfilter,
			ngptfilter: pumamod.ngptfilter,
			nspvfilter: pumamod.nspvfilter,
			filterkappa: pumamod.filterkappa,
			nfilterexp: pumamod.nfilterexp,
			landhoskn0: pumamod.landhoskn0,
		}).gridToSpectral,
		latitudes: grid.latitudes,
		truncation: request.truncation,
	}).map((value) => value / (pumamod.cv * pumamod.cv))
	let r = 0
	for (let m = 0; m <= request.truncation; m++)
		for (let n = m; n <= request.truncation; n++, r += 2)
			if (n > surf.noromax) so.fill(0, r, r + 2)
	if (glacier.nglacier === 1)
		dsnowz.forEach((value, h) => {
			if (value > 30) dglac[h] = 1
		})
	const dpersist = dls.map((value) => (value < 0.5 ? 0 : 1))

	// vegini
	const dagg = field({ code: CODE.ABOVE_GROUND_GROWTH, fallback: veg.rinidagg })
	const dsc = field({ code: CODE.STOMATAL_CONDUCTANCE, fallback: veg.rinidsc })
	const dmr = field({ code: CODE.MAXIMUM_ROUGHNESS, fallback: veg.rinidmr })
	const dgrow = field({ code: CODE.BIOMASS_GROWTH, fallback: veg.forgrow })
	dforest.forEach((_, h) => {
		if (dls[h] === 0) dforest[h] = 0
	})

	// iceini's read_ice_surface and iceget, and oceanini's oceanget.
	const xls = field({ code: CODE.LAND_MASK, fallback: 0 }).map((value) =>
		value > 0.5 ? 1 : 0,
	)
	const xclsst = climatology({ code: CODE.SURFACE_TEMPERATURE, fallback: -999 })
	let xclicec = climatology({ code: CODE.ICE_COVER, fallback: -999 })
	let xcliced = climatology({ code: CODE.ICE_THICKNESS, fallback: -999 })
	if (ice.nseaice === 0) {
		xclicec.fill(0)
		xcliced.fill(0)
	}
	const coverMax = extreme({ values: xclicec, sign: 1 })
	if (ice.nice >= 0) {
		if (coverMax > 5) xclicec = xclicec.map((value) => value * 0.01)
		if (coverMax < 0)
			xclicec = xclicec.map((_, i) =>
				ice.nice > 0.5 && xclsst[i] <= ice.tfreeze ? 1 : 0,
			)
		if (xcliced[0] < 0) xcliced = iceThickness({ cover: xclicec, grid })
	}
	for (let i = 0; i < xclicec.length; i++)
		if (ice.nseaice === 0 || xls[i % points] >= 1) {
			xclicec[i] = 0
			xcliced[i] = 0
		}
	const xclssto = monthly({ table: xclsst, step, pumamod, points })
	const xclsst2 = monthly({ table: xclsst, step: step + 1, pumamod, points })
	const xcliced2 = monthly({
		table: xcliced,
		step: step + 1,
		pumamod,
		points,
	}).map((value) => Math.max(value, 0))
	const xclicec2 = monthly({
		table: xclicec,
		step: step + 1,
		pumamod,
		points,
	}).map((value, h) => (xcliced2[h] <= 0 ? 0 : Math.max(value, 0)))
	const xiced = xcliced2.slice()
	const xicec = xclicec2.map((value) => (value >= ice.thicec ? 1 : 0))
	const yls = field({ code: CODE.LAND_MASK, fallback: 0 }).map((value) =>
		value > 0.5 ? 1 : 0,
	)
	const yclsst = climatology({
		code: CODE.SURFACE_TEMPERATURE,
		fallback: 0,
	}).map((value) => Math.max(value, ice.tfreeze))
	const yclsst2 = monthly({ table: yclsst, step: step + 1, pumamod, points })
	const ymld = new Float64Array(points).fill(ocean.mldepth)

	// seaini on sea points.
	const seaDts = zero()
	const seaDqs = zero()
	const seaDsst = zero()
	const dicec = zero()
	const diced = zero()
	const dmld = zero()
	const seaPoints =
		points - Math.round(dls.reduce((sum, value) => sum + value, 0))
	if (seaPoints > 0)
		for (let h = 0; h < points; h++) {
			if (dls[h] >= 0.5) continue
			const ts = yclsst2[h]
			seaDts[h] = ts
			dicec[h] = xicec[h]
			diced[h] = xiced[h]
			dsnow[h] = 0
			seaDsst[h] = ts
			dmld[h] = ymld[h]
			dt[surfaceLevel + h] = ts
			seaDqs[h] = saturation({ temperature: ts, pumamod })
			dq[surfaceLevel + h] = seaDqs[h]
			const c = dicec[h]
			drhs[h] = sea.drhssea * (1 - c) + sea.drhsice * c
			dalb[h] =
				sea.albsea * (1 - c) +
				c * Math.min(sea.albice, 0.5 + 0.025 * (273 - ts))
			dsalb[h] =
				sea.doceanalb[0] * (1 - c) +
				c * Math.min(sea.dicealbmx[0], sea.dicealbmn[0] + 0.025 * (273 - ts))
			dsalb[points + h] =
				sea.doceanalb[1] * (1 - c) +
				c * Math.min(sea.dicealbmx[1], sea.dicealbmn[1] + 0.025 * (273 - ts))
			dz0[h] = sea.dz0sea * (1 - c) + sea.dz0ice * c
		}

	return {
		so,
		fields: {
			dls,
			dz0,
			drhs,
			dwatc,
			dqco2: new Float64Array(request.levels * points).fill(
				rad.co2 > 0 ? rad.co2 : 0,
			),
			co2: Float64Array.of(rad.co2),
			dalb,
			dsalb,
			dicec,
			diced,
			dmld,
			dforest,
			dglac,
			dpersist,
			dwmax,
			dsnow,
			dtsoil: soil[0],
			dtd2: soil[1],
			dtd3: soil[2],
			dtd4: soil[3],
			dtd5: soil[4],
			dt,
			dq,
			land_dts: landDts,
			land_dtsm: landDtsm,
			land_dqs: landDqs,
			duroff,
			dvroff,
			darea: rowWeights,
			dsnowt,
			dsnowz,
			dz0climo,
			dalbclim,
			dalbclim1,
			dalbclim2,
			dsoilt,
			dalbcl,
			dalbcl1,
			dalbcl2,
			dagg,
			dgrow,
			dsc,
			dmr,
			xts: yclsst2.slice(),
			xsst: yclsst2.slice(),
			xmld: ymld.slice(),
			xls,
			xiced,
			xicec,
			xgw: rowWeights.slice(),
			xclsst2,
			xclicec2,
			xcliced2,
			xclssto,
			xclsst,
			xclicec,
			xcliced,
			ysst: yclsst2,
			ymld,
			yls,
			yclsst2: yclsst2.slice(),
			yclsst,
			sea_dts: seaDts,
			sea_dqs: seaDqs,
			sea_dsst: seaDsst,
		},
	}
}

export const SURFACE_SETUP = {
	CLIMATOLOGY_CODES,
	initial,
}
