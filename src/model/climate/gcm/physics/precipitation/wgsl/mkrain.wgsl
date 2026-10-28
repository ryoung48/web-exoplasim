struct Evaporation {
	flux: f32,
	dqdt: f32,
}

// Evaporation of falling precipitation into a subsaturated level, at most
// the whole flux. Returns the remaining flux and the moistening.
fn evaporate(flux: f32, deficit: f32, zlcpe: f32, zqsat: f32, zcor: f32, zt: f32, ds: f32) -> Evaporation {
	let zdqdt = min(GAMMA * deficit * ds / DELTSEC2
		/ (1.0 + zlcpe * RA2 * (TMELT - RA4) * zqsat * zcor / ((zt - RA4) * (zt - RA4))), flux);
	return Evaporation(flux - zdqdt, zdqdt / ds);
}

// rainmod's mkrain (nevapprec = 1): carry convective and large-scale
// precipitation down the column, melting or freezing it across TMELT and
// evaporating it into subsaturated levels, then the surface rates.
fn mkrain(h: u32) {
	let dp = state[DP + h];
	var zprc = 0.0;
	var zprl = 0.0;
	var zprsc = 0.0;
	var zprsl = 0.0;
	for (var l = 0u; l < NLEV; l++) {
		let ds = tables[TABLE_DSIGMA + l];
		let dq = state[at(DQ, l, h)];
		var zdtdt = 0.0;
		var zdqdtl = 0.0;
		var zdqdts = 0.0;
		zprc = zprc + state[at(DPRCL, l, h)] - state[at(DPRSCL, l, h)];
		zprl = zprl + state[at(DPRLL, l, h)] - state[at(DPRSLL, l, h)];
		zprsc = zprsc + state[at(DPRSCL, l, h)];
		zprsl = zprsl + state[at(DPRSLL, l, h)];
		// Melting at the level and, for the lowest level, at the surface.
		let surface = select(1u, 2u, l == NLEV - 1u);
		for (var below = 0u; below < surface; below++) {
			let temperature = state[at(DT, l + below, h)];
			let zlcp = (ALS - ALV) / (ACPD * (1.0 + ADV * dq));
			if (zprsc + zprsl > 0.0 && temperature > TMELT) {
				zdtdt = -(zprsc + zprsl) / ds * zlcp + zdtdt;
				zprc = zprsc + zprc;
				zprl = zprsl + zprl;
				zprsc = 0.0;
				zprsl = 0.0;
			} else if (zprc + zprl > 0.0 && temperature <= TMELT) {
				zdtdt = (zprc + zprl) / ds * zlcp + zdtdt;
				zprsc = zprc + zprsc;
				zprsl = zprl + zprsl;
				zprc = 0.0;
				zprl = 0.0;
			}
		}
		let zq = dq + state[at(DQDT, l, h)] * DELTSEC2;
		let zt = state[at(DT, l, h)] + state[at(DTDT, l, h)] * DELTSEC2;
		var zqsat = saturation_capped(zt, dp * tables[TABLE_SIGMA + l]);
		let zcor = 1.0 / (1.0 - MOIST * zqsat);
		zqsat = zqsat * zcor;
		if (zqsat < 0.0) {
			zqsat = 0.0;
		}
		if (zq < zqsat) {
			let deficit = zqsat - zq;
			let water = ALV / (ACPD * (1.0 + ADV * dq));
			let ice = ALS / (ACPD * (1.0 + ADV * dq));
			if (zprl > 0.0) {
				let e = evaporate(zprl, deficit, water, zqsat, zcor, zt, ds);
				zprl = e.flux;
				zdtdt = zdtdt - e.dqdt * water;
				zdqdtl = zdqdtl + e.dqdt;
			}
			if (zprc > 0.0) {
				let e = evaporate(zprc, deficit, water, zqsat, zcor, zt, ds);
				zprc = e.flux;
				zdtdt = zdtdt - e.dqdt * water;
				zdqdtl = zdqdtl + e.dqdt;
			}
			if (zprsl > 0.0) {
				let e = evaporate(zprsl, deficit, ice, zqsat, zcor, zt, ds);
				zprsl = e.flux;
				zdtdt = zdtdt - e.dqdt * ice;
				zdqdts = zdqdts + e.dqdt;
			}
			if (zprsc > 0.0) {
				let e = evaporate(zprsc, deficit, ice, zqsat, zcor, zt, ds);
				zprsc = e.flux;
				zdtdt = zdtdt - e.dqdt * ice;
				zdqdts = zdqdts + e.dqdt;
			}
		}
		state[at(DQDT, l, h)] = state[at(DQDT, l, h)] + zdqdtl + zdqdts;
		state[at(DTDT, l, h)] = state[at(DTDT, l, h)] + zdtdt;
	}
	state[DPRC + h] = (zprc + zprsc) * dp / GA / 1000.0;
	state[DPRL + h] = (zprl + zprsl) * dp / GA / 1000.0;
	state[DPRS + h] = (zprsc + zprsl) * dp / GA / 1000.0;
}
