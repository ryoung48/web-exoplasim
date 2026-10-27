import { SPECBLOCK } from "@/model/climate/gcm/physics/radiation/spectrum/specblock"
import type {
	GcmBandAlbedo,
	GcmPlanckPoint,
	GcmSpectrum,
	GcmSpectrumRequest,
	GcmTrapezoid,
} from "@/model/climate/gcm/physics/radiation/spectrum/types"

// hc/k (m·K).
const HC_OVER_K = 0.0143877735383
// The G-star temperature solarini normalizes the Rayleigh coefficient to.
const SUN_K = 5772
// radmod's default zsolar1, which solarini's rcoeff reads before replacing it.
const DEFAULT_ZSOLAR1 = 0.517
// Band edge (m) and the long-wave end of the integration (log10 m).
const HINGE_M = 7.5e-7
const LOG_LONGEST = -4
const POINTS = 1024
// Albedo-table index where the second band starts (wavelengths(42)).
const BAND_TWO = 41

// x^n as gfortran expands an integer power: squarings, then a multiply.
function power5(x: number): number {
	const x2 = x * x
	return x2 * x2 * x
}

function power4(x: number): number {
	const x2 = x * x
	return x2 * x2
}

// Planck's law up to a constant, as solarini writes it:
// 1/wvm * 1/(exp(c/λ) - 1), evaluated left to right.
function planck({ wavelength, scaled, constant }: GcmPlanckPoint): number {
	return ((1 / scaled) * 1) / (Math.exp(constant / wavelength) - 1)
}

// One trapezoid of solarini's sums over a grid, and of its λ⁻⁴-weighted
// (Rayleigh cross-section) sums.
function trapezoid({ values, at, k }: GcmTrapezoid): number {
	return 0.5 * (values[k] + values[k + 1]) * (at[k + 1] - at[k])
}

function crossSection({ values, at, k }: GcmTrapezoid): number {
	return (
		0.5 *
		(values[k] / power4(at[k] * 1e6) +
			values[k + 1] / power4(at[k + 1] * 1e6)) *
		(at[k + 1] - at[k])
	)
}

// radmod's solarini for a blackbody star (nstarfile = 0): the energy split
// at 0.75 µm, the Rayleigh coefficient relative to the Sun, and each
// surface's albedo averaged over the star's spectrum in each band.
function split({
	starTemperatureK,
	minWavelengthM,
	simpleAlbedo,
}: GcmSpectrumRequest): GcmSpectrum {
	const constg = HC_OVER_K / SUN_K
	const constant = HC_OVER_K / starTemperatureK
	const lwmin = Math.log10(minWavelengthM)
	const hinge = Math.log10(HINGE_M)
	const dl1 = (hinge - lwmin) / POINTS
	const dl2 = (LOG_LONGEST - hinge) / POINTS
	const wv1 = Array.from({ length: POINTS }, (_, k) => 10 ** (lwmin + k * dl1))
	const wv2 = Array.from({ length: POINTS }, (_, k) => 10 ** (hinge + k * dl2))
	const wvm1 = wv1.map((value) => power5(1e6 * value))
	const wvm2 = wv2.map((value) => power5(1e6 * value))
	const bbg1 = wv1.map((value, k) =>
		planck({ wavelength: value, scaled: wvm1[k], constant: constg }),
	)
	const bbg2 = wv2.map((value, k) =>
		planck({ wavelength: value, scaled: wvm2[k], constant: constg }),
	)
	const bb1 = wv1.map((value, k) =>
		planck({ wavelength: value, scaled: wvm1[k], constant }),
	)
	const bb2 = wv2.map((value, k) =>
		planck({ wavelength: value, scaled: wvm2[k], constant }),
	)
	const { wavelengths } = SPECBLOCK
	const bb3 = wavelengths.map((value) =>
		planck({
			wavelength: value,
			scaled: power5(value),
			constant: 1e6 * constant,
		}),
	)
	let z1 = 0
	let z2 = 0
	let zg1 = 0
	let zg2 = 0
	let zcross1 = 0
	let zcross2 = 0
	let zgcross1 = 0
	let zgcross2 = 0
	for (let k = 0; k < POINTS - 1; k++) {
		z1 = z1 + trapezoid({ values: bb1, at: wv1, k })
		z2 = z2 + trapezoid({ values: bb2, at: wv2, k })
		zg1 = zg1 + trapezoid({ values: bbg1, at: wv1, k })
		zg2 = zg2 + trapezoid({ values: bbg2, at: wv2, k })
		zcross1 = zcross1 + crossSection({ values: bb1, at: wv1, k })
		zcross2 = zcross2 + crossSection({ values: bb2, at: wv2, k })
		zgcross1 = zgcross1 + crossSection({ values: bbg1, at: wv1, k })
		zgcross2 = zgcross2 + crossSection({ values: bbg2, at: wv2, k })
	}
	// The gap between the two grids at the band edge.
	const last = POINTS - 1
	const gap = wv2[0] - wv1[last]
	z1 = z1 + 0.5 * (bb1[last] + bb2[0]) * gap
	zcross1 =
		zcross1 +
		0.5 *
			(bb1[last] / power4(wv1[last] * 1e6) + bb2[0] / power4(wv2[0] * 1e6)) *
			gap
	zg1 = zg1 + 0.5 * (bbg1[last] + bbg2[0]) * gap
	zgcross1 =
		zgcross1 +
		0.5 *
			(bbg1[last] / power4(wv1[last] * 1e6) + bbg2[0] / power4(wv2[0] * 1e6)) *
			gap
	const zchi = (zgcross1 + zgcross2) / (zg1 + zg2)
	const rcoeff = ((zcross1 + zcross2) * DEFAULT_ZSOLAR1) / z1 / zchi
	const zdenom1 = 0.01 / z1
	const zdenom2 = 0.01 / z2
	const znet = z1 + z2
	const zsolar1 = z1 / znet
	const zsolar2 = 1 - zsolar1
	const band = (albedo: number[]): GcmBandAlbedo => {
		let a1 = 0
		let a2 = 0
		for (let k = 0; k < BAND_TWO; k++)
			a1 =
				a1 +
				0.5 *
					(bb3[k] * albedo[k] + bb3[k + 1] * albedo[k + 1]) *
					1e-6 *
					(wavelengths[k + 1] - wavelengths[k])
		for (let k = BAND_TWO; k < wavelengths.length - 1; k++)
			a2 =
				a2 +
				0.5 *
					(bb3[k] * albedo[k] + bb3[k + 1] * albedo[k + 1]) *
					1e-6 *
					(wavelengths[k + 1] - wavelengths[k])
		a1 = zdenom1 * a1
		a2 = zdenom2 * a2
		const broadband = zsolar1 * a1 + zsolar2 * a2
		return simpleAlbedo ? [broadband, broadband] : [a1, a2]
	}
	return {
		zsolar1,
		zsolar2,
		rcoeff,
		dsnowalb: band(SPECBLOCK.iceblend),
		dsnowalbmn: band(SPECBLOCK.iceblendmin),
		dsnowalbmx: band(SPECBLOCK.iceblendmax),
		dicealbmn: band(SPECBLOCK.seaicemin),
		dicealbmx: band(SPECBLOCK.seaicemax),
		dglacalbmn: band(SPECBLOCK.glacalbmin),
		dgroundalb: band(SPECBLOCK.groundblend),
		doceanalb: band(SPECBLOCK.oceanblend),
	}
}

export const SPECTRUM = {
	split,
}
