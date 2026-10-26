override GASCON: f32;
override GA: f32;
override ACPD: f32;
override ADV: f32;

fn at(field: u32, l: u32, h: u32) -> u32 {
	return field + l * NHOR + h;
}

// radstep after swr and lwr: net flux, the heating each flux divergence
// gives, and the flux convergence per metre of layer.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) {
		return;
	}
	for (var l = 0u; l < NLEP; l++) {
		state[at(DFLUX, l, h)] = state[at(DLWFL, l, h)] + state[at(DSWFL, l, h)];
	}
	let dp = state[DP + h];
	for (var l = 0u; l < NLEV; l++) {
		let zdh = -state[at(DT, l, h)] * GASCON / GA * tables[TABLE_RAD_LNSIG + l];
		let denominator = tables[TABLE_DSIGMA + l] * dp * ACPD * (1.0 + ADV * state[at(DQ, l, h)]);
		let flux = state[at(DFLUX, l, h)];
		let below = state[at(DFLUX, l + 1u, h)];
		state[at(DTDT, l, h)] = state[at(DTDT, l, h)] - GA * (below - flux) / denominator;
		state[at(DTDTSWR, l, h)] = -GA * (state[at(DSWFL, l + 1u, h)] - state[at(DSWFL, l, h)]) / denominator;
		state[at(DTDTLWR, l, h)] = -GA * (state[at(DLWFL, l + 1u, h)] - state[at(DLWFL, l, h)]) / denominator;
		state[at(DCONV, l, h)] = (flux - below) / (zdh + 1.0e-9);
	}
}
