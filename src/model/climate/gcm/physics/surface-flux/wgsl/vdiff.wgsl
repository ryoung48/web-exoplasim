override RDBRV: f32;
override GASCON: f32;
override GA: f32;
override ACPD: f32;
override ADV: f32;
override DELTSEC2: f32;
override ZUMIN: f32;
override VDIFF_B: f32;
override VDIFF_C: f32;
override VDIFF_D: f32;
// ndheat > 0: kinetic energy lost to vertical diffusion heats each level.
override NDHEAT: bool;


fn at(field: u32, l: u32, h: u32) -> u32 {
	return field + l * NHOR + h;
}

// One tridiagonal elimination of the ECHAM semi-implicit scheme for a
// plain field (momentum, kinetic energy, humidity), in place.
fn diffuse(x: ptr<function, array<f32, NLEV>>, k: ptr<function, array<f32, NLEV>>) {
	var ebs: array<f32, NLEV>;
	let ds0 = tables[TABLE_DSIGMA];
	ebs[0] = (*k)[0] / (ds0 + (*k)[0]);
	(*x)[0] = ds0 * (*x)[0] / (ds0 + (*k)[0]);
	for (var l = 1u; l < NLEM; l++) {
		let ds = tables[TABLE_DSIGMA + l];
		let denominator = ds + (*k)[l] + (*k)[l - 1u] * (1.0 - ebs[l - 1u]);
		ebs[l] = (*k)[l] / denominator;
		(*x)[l] = ((*x)[l] * ds + (*k)[l - 1u] * (*x)[l - 1u]) / denominator;
	}
	let dsn = tables[TABLE_DSIGMA + NLEV - 1u];
	(*x)[NLEV - 1u] = ((*x)[NLEV - 1u] * dsn + (*k)[NLEM - 1u] * (*x)[NLEM - 1u])
		/ (dsn + (*k)[NLEM - 1u] * (1.0 - ebs[NLEM - 1u]));
	for (var l = i32(NLEM) - 1; l >= 0; l--) {
		(*x)[l] = (*x)[l] + ebs[l] * (*x)[l + 1];
	}
}

// fluxmod's vdiff for one column: Richardson-number dependent diffusion
// coefficients between levels, then implicit diffusion of u, v, q and
// potential temperature, with kinetic-energy dissipation as heating.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) {
		return;
	}
	var zt: array<f32, NLEV>;
	var zq: array<f32, NLEV>;
	var zu: array<f32, NLEV>;
	var zv: array<f32, NLEV>;
	var zabsu: array<f32, NLEV>;
	var zskap: array<f32, NLEV>;
	var zskaph: array<f32, NLEV>;
	for (var l = 0u; l < NLEV; l++) {
		zt[l] = state[at(DT, l, h)] + state[at(DTDT, l, h)] * DELTSEC2;
		zq[l] = state[at(DQ, l, h)] + state[at(DQDT, l, h)] * DELTSEC2;
		zu[l] = state[at(DU, l, h)] + state[at(DUDT, l, h)] * DELTSEC2;
		zv[l] = state[at(DV, l, h)] + state[at(DVDT, l, h)] * DELTSEC2;
		zabsu[l] = sqrt(zu[l] * zu[l] + zv[l] * zv[l]);
		zskap[l] = tables[TABLE_VDIFF_SKAP + l];
		zskaph[l] = tables[TABLE_VDIFF_SKAPH + l];
	}
	let zkonst1 = GA * DELTSEC2 / GASCON;
	let zkonst2 = zkonst1 * GA / GASCON;
	let zkonst3 = zkonst2 * GA / GASCON;
	let moisture = 1.0 / RDBRV - 1.0;
	var kh: array<f32, NLEV>;
	var km: array<f32, NLEV>;
	for (var l = 0u; l < NLEM; l++) {
		let lp = l + 1u;
		// Mixing lengths, the stability factor and sigma terms depend only on
		// the level; SURFACE_FLUX.tables computes them in f64.
		let sigmah = tables[TABLE_SIGMAH + l];
		let dsigma = tables[TABLE_DSIGMA + l];
		let dsigmap = tables[TABLE_DSIGMA + lp];
		let zmixh2 = tables[TABLE_VDIFF_MIXH2 + l];
		let zmixm2 = tables[TABLE_VDIFF_MIXM2 + l];
		let zrdsig = tables[TABLE_VDIFF_RDSIG + l];
		let zfac = zkonst3 * tables[TABLE_VDIFF_SIGMAH3 + l];
		let zzkfac = tables[TABLE_VDIFF_KFAC + l];
		let zrthl = (dsigmap + dsigma) / (zt[l] * dsigmap + zt[lp] * dsigma);
		let zdvds = max(ZUMIN, abs(zabsu[l] - zabsu[lp])) * zrdsig;
		let zdthds = (zt[l] * (1.0 + moisture * zq[l]) / zskap[l]
			- zt[lp] * (1.0 + moisture * zq[lp]) / zskap[lp]) * zrdsig;
		let zri = zskaph[l] * GASCON * zdthds / (sigmah * zdvds * zdvds);
		var zrifh: f32;
		var zrifm: f32;
		if (zri <= 0.0) {
			let zdenomh = 1.0 + 3.0 * VDIFF_C * VDIFF_B * sqrt(-1.0 * zri) * zzkfac * zmixh2;
			let zdenomm = 1.0 + 3.0 * VDIFF_C * VDIFF_B * sqrt(-1.0 * zri) * zzkfac * zmixm2;
			zrifh = 1.0 - 3.0 * VDIFF_B * zri / zdenomh;
			zrifm = 1.0 - 2.0 * VDIFF_B * zri / zdenomm;
		} else {
			let zdenom = sqrt(1.0 + VDIFF_D * zri);
			zrifh = 1.0 / (1.0 + 3.0 * VDIFF_B * zri * zdenom);
			zrifm = 1.0 / (1.0 + 2.0 * VDIFF_B * zri / zdenom);
		}
		kh[l] = zfac * zmixh2 * zrifh * zdvds * zrthl * zrthl * zrthl;
		km[l] = zfac * zmixm2 * zrifm * zdvds * zrthl * zrthl * zrthl;
	}

	var zun = zu;
	var zvn = zv;
	diffuse(&zun, &km);
	diffuse(&zvn, &km);
	for (var l = 0u; l < NLEV; l++) {
		state[at(DUDT, l, h)] = state[at(DUDT, l, h)] + (zun[l] - zu[l]) / DELTSEC2;
		state[at(DVDT, l, h)] = state[at(DVDT, l, h)] + (zvn[l] - zv[l]) / DELTSEC2;
	}
	if (NDHEAT) {
		var zke: array<f32, NLEV>;
		for (var l = 0u; l < NLEV; l++) {
			zke[l] = 0.5 * zabsu[l] * zabsu[l];
		}
		var zken = zke;
		diffuse(&zken, &km);
		for (var l = 0u; l < NLEV; l++) {
			let zdtdt = -((zun[l] * zun[l] - zu[l] * zu[l] + zvn[l] * zvn[l] - zv[l] * zv[l]) / DELTSEC2
				- (zken[l] - zke[l]) / DELTSEC2) * 0.5 / ACPD / (1.0 + ADV * state[at(DQ, l, h)]);
			state[at(DTDT, l, h)] = state[at(DTDT, l, h)] + zdtdt;
		}
	}

	var zqn = zq;
	diffuse(&zqn, &kh);
	for (var l = 0u; l < NLEV; l++) {
		state[at(DQDT, l, h)] = state[at(DQDT, l, h)] + (zqn[l] - zq[l]) / DELTSEC2;
	}

	// Potential temperature: the same elimination with kh scaled by
	// sigmah^kappa and each level's sigma^kappa folded in.
	for (var l = 0u; l < NLEM; l++) {
		kh[l] = kh[l] * zskaph[l];
	}
	var ebs: array<f32, NLEV>;
	var ztn: array<f32, NLEV>;
	let ds0 = tables[TABLE_DSIGMA];
	ebs[0] = kh[0] / (ds0 + kh[0] / zskap[0]);
	ztn[0] = ds0 * zt[0] / (ds0 + kh[0] / zskap[0]);
	for (var l = 1u; l < NLEM; l++) {
		let ds = tables[TABLE_DSIGMA + l];
		let denominator = ds + (kh[l] + kh[l - 1u] * (1.0 - ebs[l - 1u] / zskap[l - 1u])) / zskap[l];
		ebs[l] = kh[l] / denominator;
		ztn[l] = (zt[l] * ds + kh[l - 1u] / zskap[l - 1u] * ztn[l - 1u]) / denominator;
	}
	let last = NLEV - 1u;
	let dsn = tables[TABLE_DSIGMA + last];
	ztn[last] = (zt[last] * dsn + kh[NLEM - 1u] * ztn[NLEM - 1u] / zskap[NLEM - 1u])
		/ (dsn + kh[NLEM - 1u] / zskap[last] * (1.0 - ebs[NLEM - 1u] / zskap[NLEM - 1u]));
	for (var l = i32(NLEM) - 1; l >= 0; l--) {
		ztn[l] = ztn[l] + ebs[l] * ztn[l + 1] / zskap[l + 1];
	}
	for (var l = 0u; l < NLEV; l++) {
		state[at(DTDT, l, h)] = state[at(DTDT, l, h)] + (ztn[l] - zt[l]) / DELTSEC2;
	}
}
