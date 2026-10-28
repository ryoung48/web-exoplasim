override DELTSEC2: f32;
override PSURF: f32;
override WW: f32;
override GA: f32;
override GASCON: f32;
override ACPD: f32;
override ADV: f32;
override ALV: f32;
override ALS: f32;
override RHBETA: f32;
override NBETA: i32;
override PDEEP: f32;
override PDEEPTH: f32;
override RKSHALLOW: f32;

struct Parcel {
	t: f32,
	q: f32,
	cor: f32,
	saturated: bool,
}

// A parcel at t, q lifted to pressure p: when supersaturated, two Newton
// steps of condensation with latent heating (sublimation below TMELT).
// cor is the last saturation correction, which kuo reuses.
fn condense(t0: f32, q0: f32, p: f32) -> Parcel {
	var s = saturation_capped(t0, p);
	var cor = 1.0 / (1.0 - MOIST * s);
	s = s * cor;
	if (!(s < q0)) {
		return Parcel(t0, q0, cor, false);
	}
	var t = t0;
	var q = q0;
	let lcp = select(ALV, ALS, t0 < TMELT) / (ACPD * (1.0 + ADV * q0));
	for (var i = 0; i < 2; i++) {
		if (i == 1) {
			s = saturation_capped(t, p);
			cor = 1.0 / (1.0 - MOIST * s);
			s = s * cor;
		}
		let dqsdt = RA2 * (TMELT - RA4) * s * cor / ((t - RA4) * (t - RA4));
		let rain = (q - s) / (1.0 + lcp * dqsdt);
		t = t + lcp * rain;
		q = q - rain;
	}
	return Parcel(t, q, cor, true);
}

// rainmod's mkdqtgp scaling, kuo and mkshallow for one column. Switches
// fixed for every page configuration: ncsurf = 1 (parcels may start at the
// surface), kbeta = 1 (moistening fraction from mean relative humidity),
// nshallow = 1, nmoment = 0 (no momentum transport).
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) {
		return;
	}
	let dp = state[DP + h];
	var zdqt: array<f32, NLEV>;
	var zqe: array<f32, NLEV>;
	var zte: array<f32, NLEV>;
	var zdqtot: array<f32, NLEV>;
	var zalcpe: array<f32, NLEV>;
	var zacpe: array<f32, NLEV>;
	var zdqdt: array<f32, NLEV>;
	var zdtdt: array<f32, NLEV>;
	for (var l = 0u; l < NLEV; l++) {
		// mkdqtgp: the dynamics' humidity tendency in physical units.
		zdqt[l] = state[at(DQT, l, h)] * PSURF * WW / dp;
		state[at(DQT, l, h)] = zdqt[l];
		let dq = state[at(DQ, l, h)];
		let dqdt = state[at(DQDT, l, h)];
		zdqtot[l] = (zdqt[l] + dqdt) * DELTSEC2;
		zqe[l] = dq + dqdt * DELTSEC2;
		zte[l] = state[at(DT, l, h)] + state[at(DTDT, l, h)] * DELTSEC2;
		zacpe[l] = ACPD * (1.0 + ADV * dq);
		zalcpe[l] = ALV / zacpe[l];
		zdqdt[l] = 0.0;
		zdtdt[l] = 0.0;
	}

	// Lifting level and cloud top under Fortran's 1-based level numbers;
	// -1 while no parcel has been lifted.
	var ilift = -1;
	var itop = -1;
	var zi = 0.0;
	var zpt = 0.0;
	var zpq = 0.0;
	var zbeta = 0.0;
	var zpbeta = 0.0;
	var ztp = 0.0;
	var zqp = 0.0;

	// A parcel from the surface into the lowest level.
	let n = NLEV - 1u;
	let dsn = tables[TABLE_DSIGMA + n];
	let ztsurf = state[at(DT, NLEV, h)] * tables[TABLE_VDIFF_SKAP + n];
	if (zdqtot[n] > 0.0 && ztsurf > zte[n]) {
		let p = dp * tables[TABLE_SIGMA + n];
		let zqsnl = saturation_divided(zte[n], p);
		let zqnew = state[at(DQ, NLEV, h)] * min(1.0, zqe[n] / zqsnl);
		let parcel = condense(ztsurf, zqnew, p);
		if (parcel.saturated) {
			ilift = i32(NLEP);
			itop = i32(NLEV);
			ztp = parcel.t;
			zqp = parcel.q;
			let zqsa = saturation_divided(zte[n], p);
			zdqdt[n] = max(zqsa - zqe[n], 0.0);
			zdtdt[n] = ztp - zte[n];
			zpt = zdtdt[n] * dsn * zacpe[n];
			zpq = zdqdt[n] * dsn * ALV;
			zbeta = min(1.0, zqe[n] / zqsa) * dsn;
			zpbeta = dsn;
			zi = zdqtot[n] * dsn * ALV;
		}
	}

	// Otherwise the lowest moistening level whose parcel, lifted one level,
	// is saturated and warmer than its surroundings.
	for (var l = i32(NLEM) - 1; l >= 0; l--) {
		let lu = u32(l);
		let lp = lu + 1u;
		if (ilift == -1 && zdqtot[lp] > 0.0) {
			let p = dp * tables[TABLE_SIGMA + lu];
			let parcel = condense(zte[lp] * tables[TABLE_KUO_ZFAC + lu], zqe[lp], p);
			if (parcel.saturated && parcel.t > zte[lu]) {
				let ds = tables[TABLE_DSIGMA + lu];
				let dsp = tables[TABLE_DSIGMA + lp];
				ilift = l + 2;
				itop = l + 1;
				ztp = parcel.t;
				zqp = parcel.q;
				let zqsa = saturation_divided(zte[lu], p);
				zdqdt[lu] = max(zqsa - zqe[lu], 0.0);
				zdtdt[lu] = ztp - zte[lu];
				zpt = zdtdt[lu] * ds * zacpe[lu];
				zpq = zdqdt[lu] * ds * ALV;
				zbeta = min(1.0, zqe[lu] / zqsa) * ds;
				zpbeta = ds;
				// The lifting level condenses too, starting from the parcel's
				// last correction factor as Fortran does.
				let pp = dp * tables[TABLE_SIGMA + lp];
				var zqsnl = saturation_divided(zte[lp], pp);
				if (zqe[lp] > zqsnl) {
					var t = zte[lp];
					var q = zqe[lp];
					let lcp = select(ALV, ALS, t < TMELT) / (ACPD * (1.0 + ADV * q));
					var cor = parcel.cor;
					for (var i = 0; i < 2; i++) {
						if (i == 1) {
							zqsnl = saturation_capped(t, pp);
							cor = 1.0 / (1.0 - MOIST * zqsnl);
							zqsnl = zqsnl * cor;
						}
						let dqsdt = RA2 * (TMELT - RA4) * zqsnl * cor / ((t - RA4) * (t - RA4));
						let rain = (q - zqsnl) / (1.0 + lcp * dqsdt);
						t = t + lcp * rain;
						q = q - rain;
					}
					zdqdt[lp] = max(q - zqe[lp], 0.0);
					zdtdt[lp] = t - zte[lp];
					zpt = zdtdt[lp] * dsp * zacpe[lp] + zpt;
					zpq = zdqdt[lp] * dsp * ALV + zpq;
					zbeta = min(1.0, zqe[lp] / zqsnl) * dsp + zbeta;
					zpbeta = dsp + zpbeta;
				}
				zi = zdqtot[lu] * ds * ALV + zdqtot[lp] * dsp * ALV;
			}
		}
	}

	// The parcel rises while it stays warmer than its surroundings.
	for (var l = i32(NLEM) - 1; l >= 0; l--) {
		let lu = u32(l);
		if (itop == l + 2) {
			let p = dp * tables[TABLE_SIGMA + lu];
			let parcel = condense(ztp * tables[TABLE_KUO_ZFAC + lu], zqp, p);
			if (parcel.saturated && parcel.t > zte[lu]) {
				let ds = tables[TABLE_DSIGMA + lu];
				itop = l + 1;
				ztp = parcel.t;
				zqp = parcel.q;
				let zqsa = saturation_divided(zte[lu], p);
				zdqdt[lu] = max(zqsa - zqe[lu], 0.0);
				zdtdt[lu] = ztp - zte[lu];
				zpt = zdtdt[lu] * ds * zacpe[lu] + zpt;
				zpq = zdqdt[lu] * ds * ALV + zpq;
				zbeta = min(1.0, zqe[lu] / zqsa) * ds + zbeta;
				zpbeta = zpbeta + ds;
				zi = zdqtot[lu] * ds * ALV + zi;
			}
		}
	}

	zi = max(0.0, zi);
	var zrhm = 0.0;
	if (zpbeta > 0.0) {
		zrhm = zbeta / zpbeta;
	}
	var beta = 1.0;
	if (zrhm >= RHBETA) {
		beta = precise_powi((1.0 - zrhm) / (1.0 - RHBETA), NBETA);
	}
	var zat = 0.0;
	var zaq = 0.0;
	if (zpt > 0.0) {
		zat = zi * (1.0 - beta) / zpt;
	}
	if (zpq > 0.0) {
		zaq = zi * beta / zpq;
	}
	var shallow = false;
	if (itop > 0 && (dp * tables[TABLE_SIGMA + u32(itop - 1)] > PDEEP || zi <= 0.0)) {
		shallow = true;
	}

	// Deep convection: heating and moistening in proportion to the parcel's
	// excess, and convective cloud levels for mkclouds.
	var icctot = 0.0;
	for (var l = 0u; l < NLEV; l++) {
		let level = i32(l) + 1;
		var dprcl = 0.0;
		var icclev = 0.0;
		if (ilift >= level && itop <= level && zi > 0.0 && !shallow) {
			state[at(DQDT, l, h)] = zaq * zdqdt[l] / DELTSEC2 - zdqt[l];
			state[at(DTDT, l, h)] = zat * zdtdt[l] / DELTSEC2 + state[at(DTDT, l, h)];
			dprcl = zat * zdtdt[l] * tables[TABLE_DSIGMA + l] / zalcpe[l] / DELTSEC2;
		}
		if (dprcl > 0.0) {
			icclev = 1.0;
			icctot = icctot + 1.0;
		}
		if (tables[TABLE_SIGMA + l] < 0.4 && icclev == 1.0 && itop == level) {
			icclev = 2.0;
		}
		state[at(DPRCL, l, h)] = dprcl;
		state[at(DPRSCL, l, h)] = 0.0;
		state[at(ICCLEV, l, h)] = icclev;
	}
	state[ICCTOT + h] = icctot;

	if (!shallow) {
		return;
	}
	// mkshallow: shallow convection as vertical diffusion between the
	// lifting level and the cloud top (raised to at least the pdeepth level).
	let zkonst1 = GA * DELTSEC2 / GASCON;
	let zkonst2 = RKSHALLOW * zkonst1 * GA / GASCON;
	var kktop = 1;
	for (var level = 2; level <= i32(NLEM); level++) {
		if (dp * tables[TABLE_SIGMA + u32(level - 1)] < PDEEPTH) {
			kktop = level;
		}
	}
	let ktop = max(itop, kktop);
	var zkdiff: array<f32, NLEV>;
	var skap: array<f32, NLEV>;
	for (var l = 0u; l < NLEV; l++) {
		zkdiff[l] = 0.0;
		skap[l] = tables[TABLE_VDIFF_SKAP + l];
	}
	for (var l = 0u; l < NLEM; l++) {
		let lp = l + 1u;
		let level = i32(l) + 1;
		let sigmah = tables[TABLE_SIGMAH + l];
		let zfac = zkonst2 * sigmah * sigmah * tables[TABLE_VDIFF_RDSIG + l];
		let ds = tables[TABLE_DSIGMA + l];
		let dsp = tables[TABLE_DSIGMA + lp];
		let zrthl = (dsp + ds) / (zte[l] * dsp + zte[lp] * ds);
		if (level >= ktop && level < ilift) {
			zkdiff[l] = zfac * zrthl * zrthl;
		}
		if (level + 1 == ktop) {
			var zzqs = saturation_capped(zte[l], dp * tables[TABLE_SIGMA + l]);
			zzqs = zzqs * (1.0 / (1.0 - MOIST * zzqs));
			var zzqsp = saturation_capped(zte[lp], dp * tables[TABLE_SIGMA + lp]);
			zzqsp = zzqsp * (1.0 / (1.0 - MOIST * zzqsp));
			let zrh = zqe[l] / zzqs;
			let zrhp = zqe[lp] / zzqsp;
			let zzf = abs((zrh - 0.8) / 0.2 * (zrhp - zrh));
			zkdiff[l] = zfac * zrthl * zrthl * zzf;
		}
	}
	var zqn = zqe;
	diffuse(&zqn, &zkdiff);
	for (var l = 0u; l < NLEM; l++) {
		zkdiff[l] = zkdiff[l] * tables[TABLE_VDIFF_SKAPH + l];
	}
	var ztn = zte;
	diffuse_potential(&ztn, &zkdiff, &skap);
	for (var l = 0u; l < NLEV; l++) {
		state[at(DTDT, l, h)] = state[at(DTDT, l, h)] + (ztn[l] - zte[l]) / DELTSEC2;
		state[at(DQDT, l, h)] = state[at(DQDT, l, h)] + (zqn[l] - zqe[l]) / DELTSEC2;
	}
}
