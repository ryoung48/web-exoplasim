// rainmod's mklsp (nstorain = 0): large-scale condensation of whatever
// exceeds saturation, by two Newton steps with latent heating.
fn mklsp(h: u32) {
	let dp = state[DP + h];
	for (var l = 0u; l < NLEV; l++) {
		state[at(DPRSLL, l, h)] = 0.0;
		var dprll = 0.0;
		let dq = state[at(DQ, l, h)];
		let zq = dq + state[at(DQDT, l, h)] * DELTSEC2;
		let zt = state[at(DT, l, h)] + state[at(DTDT, l, h)] * DELTSEC2;
		let zlcpe = ALV / (ACPD * (1.0 + ADV * dq));
		let p = dp * tables[TABLE_SIGMA + l];
		var zqsat = saturation_capped(zt, p);
		var zcor = 1.0 / (1.0 - MOIST * zqsat);
		zqsat = zqsat * zcor;
		if (zqsat < 0.0) {
			zqsat = 0.0;
		}
		if (zq > zqsat) {
			var zdqdt = (zqsat - zq)
				/ (1.0 + zlcpe * RA2 * (TMELT - RA4) * zqsat * zcor / ((zt - RA4) * (zt - RA4)));
			var ztn = zt - zdqdt * zlcpe;
			var zqn = zq + zdqdt;
			zqsat = saturation_capped(ztn, p);
			zcor = 1.0 / (1.0 - MOIST * zqsat);
			zqsat = zqsat * zcor;
			zdqdt = (zqsat - zqn)
				/ (1.0 + zlcpe * RA2 * (TMELT - RA4) * zqsat * zcor / ((ztn - RA4) * (ztn - RA4)));
			ztn = ztn - zdqdt * zlcpe;
			zqn = zqn + zdqdt;
			let dqdt = (zqn - zq) / DELTSEC2;
			let dtdt = (ztn - zt) / DELTSEC2;
			state[at(DQDT, l, h)] = state[at(DQDT, l, h)] + dqdt;
			state[at(DTDT, l, h)] = state[at(DTDT, l, h)] + dtdt;
			dprll = -min(dqdt, 0.0) * tables[TABLE_DSIGMA + l];
		}
		state[at(DPRLL, l, h)] = dprll;
	}
}
