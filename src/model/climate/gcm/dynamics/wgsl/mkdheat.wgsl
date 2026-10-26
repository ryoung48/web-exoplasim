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
// heating. ZU/ZV hold winds before diffusion and ZUN/ZVN after.
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
	let scale = sqrt(tables[TABLE_RCSQ + h]);
	let u = CV * state[ZU + i] * scale;
	let v = CV * state[ZV + i] * scale;
	let un = CV * state[ZUN + i] * scale;
	let vn = CV * state[ZVN + i] * scale;
	let change = un * un - u * u + vn * vn - v * v;
	if (STAGE == 1u) {
		let dtdt = -change / DELTSEC2 * 0.5 / ACPD / heat;
		state[ZDTDT + i] = dtdt / CT / WW;
	} else {
		state[ZDEKIN + i] = change / DELTSEC2 * state[DP + h] / GA * tables[TABLE_DSIGMA + l];
	}
}
