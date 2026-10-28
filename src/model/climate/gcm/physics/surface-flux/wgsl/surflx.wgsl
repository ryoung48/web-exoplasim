override RDBRV: f32;
override GASCON: f32;
override GA: f32;
override ACPD: f32;
override ADV: f32;
override DELTSEC: f32;
override DELTSEC2: f32;
override RA2: f32;
override RA4: f32;
override TMELT: f32;
override ALV: f32;
override ALS: f32;
override ZUMIN: f32;
override VDIFF_B: f32;
override VDIFF_C: f32;
override VDIFF_D: f32;
// ndheat > 0: the kinetic energy taken by surface stress heats the
// lowest level.
override NDHEAT: bool;

const VONKARMAN: f32 = 0.4;

fn at(field: u32, l: u32, h: u32) -> u32 {
	return field + l * NHOR + h;
}

// fluxmod's surflx (ntsa = 2) and the implicit surface fluxes it calls:
// mkstress, mkshfl, mkevap. One column; level NLEV - 1 is the lowest
// atmospheric level, NLEV the surface.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) {
		return;
	}
	let low = NLEV - 1u;
	let u = state[at(DU, low, h)];
	let v = state[at(DV, low, h)];
	let t = state[at(DT, low, h)];
	let q = state[at(DQ, low, h)];
	let ts = state[at(DT, NLEV, h)];
	let qs = state[at(DQ, NLEV, h)];
	let dp = state[DP + h];
	let dls = state[DLS + h];
	let dsigma = tables[TABLE_DSIGMA + low];
	// sigma(NLEV)^-kappa and ln sigma(NLEV), from f64 set-up tables.
	let zfac = tables[TABLE_FLUX_SIGFAC];
	let zlnsig = tables[TABLE_FLUX_LNSIG];
	let moisture = 1.0 / RDBRV - 1.0;

	// surflx: transfer coefficients
	var dtsa = t * zfac * (1.0 + moisture * q);
	let zabsu2 = max(ZUMIN, u * u + v * v);
	let znl = -GASCON * 0.5 * (t + dtsa) * zlnsig / GA;
	let zbz0 = znl / state[DZ0 + h];
	let zri = GA * znl / (zabsu2 * dtsa) * (dtsa - ts * (1.0 + moisture * qs));
	let zkblnz = VONKARMAN / log(zbz0 + 1.0);
	let zkblnz2 = zkblnz * zkblnz;
	var zrifm: f32;
	var zrifh: f32;
	if (zri <= 0.0) {
		let zdenom = 1.0 + 3.0 * VDIFF_C * VDIFF_B * sqrt(-1.0 * zri * (zbz0 + 1.0)) * zkblnz2;
		zrifm = 1.0 - 2.0 * VDIFF_B * zri / zdenom;
		if (dls < 1.0) {
			// Unstable over sea (Miller et al. 1992).
			let zdth = -(dtsa - ts * (1.0 + moisture * qs));
			zrifh = pow(1.0 + pow(0.0016 * pow(zdth, 1.0 / 3.0) / sqrt(zabsu2) / zkblnz2, 1.25), 0.8);
		} else {
			zrifh = 1.0 - 3.0 * VDIFF_B * zri / zdenom;
		}
	} else {
		let zdenom = sqrt(1.0 + VDIFF_D * zri);
		zrifh = 1.0 / (1.0 + 3.0 * VDIFF_B * zri * zdenom);
		zrifm = 1.0 / (1.0 + 2.0 * VDIFF_B * zri / zdenom);
	}
	let ztrans = sqrt(zabsu2) * zkblnz2;
	let transh = ztrans * zrifh;
	let transm = ztrans * zrifm;
	state[DTRANSH + h] = transh;
	state[DTRANSM + h] = transm;

	let zkonst1 = GA * DELTSEC2 / (GASCON * dsigma);
	let zkonst2 = dsigma / DELTSEC2 / GA;

	// mkstress: implicit surface drag
	let zkdiffm = zkonst1 * transm / ts;
	let zun = u / (1.0 + zkdiffm);
	let zvn = v / (1.0 + zkdiffm);
	state[at(DUDT, low, h)] = state[at(DUDT, low, h)] + (zun - u) / DELTSEC2;
	state[at(DVDT, low, h)] = state[at(DVDT, low, h)] + (zvn - v) / DELTSEC2;
	var dtdt = state[at(DTDT, low, h)];
	if (NDHEAT) {
		dtdt = dtdt + -(zun * zun - u * u + zvn * zvn - v * v) / DELTSEC2 * 0.5 / ACPD / (1.0 + ADV * q);
	}
	let taux = dp * zkonst2 * zkdiffm * zun;
	let tauy = dp * zkonst2 * zkdiffm * zvn;
	state[DTAUX + h] = taux;
	state[DTAUY + h] = tauy;
	let ustar = sqrt(sqrt(taux * taux + tauy * tauy) * GASCON * ts / dp);
	state[DUST3 + h] = ustar * ustar * ustar;

	// mkshfl: implicit sensible heat flux
	let zkdiffh = zkonst1 * transh / ts;
	let ztn = (t + zkdiffh * ts) / (1.0 + zkdiffh * zfac);
	dtdt = dtdt + (ztn - t) / DELTSEC2;
	state[at(DTDT, low, h)] = dtdt;
	let moist = max(1.0, 1.0 + ADV * q);
	state[DSHFL + h] = zkonst2 * zkdiffh * dp * ACPD * moist * (ztn * zfac - ts);
	state[DSHDT + h] = -1.0 * zkonst2 * zkdiffh * dp * ACPD * moist;
	dtsa = ztn * zfac;
	state[DTSA + h] = dtsa;

	// mkevap: implicit evaporation, limited on land by soil water
	let zkdiffq = state[DRHS + h] * zkonst1 * transh / ts;
	var zqn = max(q, (q + zkdiffq * qs) / (1.0 + zkdiffq));
	if (dls > 0.0) {
		zqn = min(zqn, state[DWATC + h] / DELTSEC * 1000.0 / dp / zkonst2 + q);
	}
	state[at(DQDT, low, h)] = state[at(DQDT, low, h)] + (zqn - q) / DELTSEC2;
	let devap = -dp * zkonst2 / 1000.0 * (zqn - q);
	state[DEVAP + h] = devap;
	let latent = select(ALS, ALV, ts > TMELT || dls < 0.5);
	let dlhfl = devap * latent * 1000.0;
	state[DLHFL + h] = dlhfl;
	let curvature = (ts - RA4) * (ts - RA4);
	let dlhdt = -1.0 * latent * zkdiffq * zkonst2 * dp * RA2 * (TMELT - RA4) * qs / curvature;
	state[DLHDT + h] = select(dlhdt, 0.0, dlhfl == 0.0);
}
