override STAGE: u32;
override CV: f32;
override CT: f32;
override WW: f32;
override GA: f32;
override ACPD: f32;
override ADV: f32;
override DELTSEC2: f32;

// mkdheat's gridpoint stages, per level and point. Stage 1 turns the kinetic
// energy lost to friction into heating; stage 2 is the kinetic energy lost
// to diffusion, per unit area; stage 3 spreads its global mean back as
// heating. ZU/ZV hold the winds before the increment and ZDU/ZDV the wind
// increment itself. plasim.f90 squares winds before and after,
// un^2 - u^2, which in f32 cancels away most of the difference; the
// identical du (2 u + du) does not.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let i = id.x;
	if (i >= THREADS) {
		return;
	}
	let l = i / NHOR;
	let h = i % NHOR;
	let heat = 1.0 + ADV * state[DQ + i];
	if (STAGE == 3u) {
		let dp = state[DP + h];
		let dtdt = -state[ZDEKIN + i] * 0.5 / ACPD / heat / dp * GA / tables[TABLE_DSIGMA + l];
		state[ZDTDT + i] = dtdt / CT / WW;
		return;
	}
	let scale = CV * sqrt(tables[TABLE_RCSQ + h]);
	let u = state[ZU + i] * scale;
	let v = state[ZV + i] * scale;
	let du = state[ZDU + i] * scale;
	let dv = state[ZDV + i] * scale;
	let change = du * (2.0 * u + du) + dv * (2.0 * v + dv);
	if (STAGE == 1u) {
		let dtdt = -change / DELTSEC2 * 0.5 / ACPD / heat;
		state[ZDTDT + i] = dtdt / CT / WW;
	} else {
		state[ZDEKIN + i] = change / DELTSEC2 * state[DP + h] / GA * tables[TABLE_DSIGMA + l];
	}
}
