import { DYNAMICS_SETUP } from "@/model/climate/gcm/dynamics/setup"
import type {
	GcmNoiseRequest,
	GcmSpectralState,
	GcmSpectralStateRequest,
} from "@/model/climate/gcm/setup/state/types"
import { GFORTRAN_RANDOM } from "@/model/shared/random/gfortran"

// noise: white noise of amplitude 1e-4 in ln(ps). kick 1 perturbs every
// non-zonal coefficient, kick 2 those symmetric about the equator (one draw
// for both parts) and kick 3 mode (1, 1) alone.
function noise({ sp, truncation, kick, seed }: GcmNoiseRequest): void {
	const random = GFORTRAN_RANDOM.seeded(seed)
	const scale = 1e-4 / Math.sqrt(2)
	const ntp1 = truncation + 1
	if (kick === 1) {
		for (let i = 2 * ntp1; i < sp.length; i++)
			sp[i] = sp[i] + scale * (GFORTRAN_RANDOM.next(random) - 0.5)
	} else if (kick === 2) {
		let r = 2 * ntp1 - 2
		for (let m = 1; m <= truncation; m++)
			for (let n = m; n <= truncation; n++) {
				r += 2
				if ((n + m) % 2 !== 0) continue
				const value = scale * (GFORTRAN_RANDOM.next(random) - 0.5)
				sp[r] = sp[r] + value
				sp[r + 1] = sp[r + 1] + value
			}
	} else if (kick === 3) {
		sp[2 * ntp1 + 2] = scale
		sp[2 * ntp1 + 3] = scale * 0.5
	}
}

// initrandom: the namelist's seed (zero-padded to gfortran's eight words),
// or one from the clock when the seed's first word is zero.
function seed({ pumamod, clock }: GcmSpectralStateRequest): number[] {
	const size = GFORTRAN_RANDOM.SEED_SIZE
	if (pumamod.seed[0] !== 0)
		return Array.from({ length: size }, (_, i) => pumamod.seed[i] ?? 0)
	return Array.from({ length: size }, (_, i) => (clock + 37 * (i + 1)) | 0)
}

// initfd after setzt: temperature at the restoration profile's global mean,
// solid-body planetary vorticity and noise in ln(ps), the same for both time
// levels. With a tidally locked gradient the whole restoration field starts.
function spectral(request: GcmSpectralStateRequest): GcmSpectralState {
	const { pumamod, dynamics, truncation } = request
	const levels = dynamics.sigma.length
	const coefficients = (truncation + 1) * (truncation + 2)
	const sr = DYNAMICS_SETUP.setzt({
		setup: dynamics,
		truncation,
		gascon: pumamod.gascon,
		ga: pumamod.ga,
		ct: pumamod.ct,
		alr: pumamod.alr,
		tgr: pumamod.tgr,
		dtrop: pumamod.dtrop,
		dttl: pumamod.dttl,
		fixedlon: pumamod.fixedlon,
	})
	const sp = new Float64Array(coefficients)
	noise({ sp, truncation, kick: pumamod.kick, seed: seed(request) })
	const st = new Float64Array(coefficients * levels)
	const sz = new Float64Array(coefficients * levels)
	for (let l = 0; l < levels; l++) {
		const at = l * coefficients
		if (pumamod.dttl !== 0) st.set(sr.subarray(at, at + coefficients), at)
		else st[at] = sr[at]
		sz[at + 2] = pumamod.plavor
	}
	return {
		sr,
		sp,
		spm: sp.slice(),
		st,
		stm: st.slice(),
		sz,
		szm: sz.slice(),
		sd: new Float64Array(coefficients * levels),
		sdm: new Float64Array(coefficients * levels),
		sq: new Float64Array(coefficients * levels),
		sqm: new Float64Array(coefficients * levels),
	}
}

export const INITIAL_STATE = {
	spectral,
}
