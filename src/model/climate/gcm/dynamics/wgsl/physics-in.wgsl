override PSURF: f32;
override CV: f32;
override CT: f32;

// gridpointd before the parameterizations, per column: zero every tendency
// and dimensionalize ps, winds, temperature and humidity. The surface level
// NLEP of dt, dq, du, dv belongs to the surface schemes and is left alone.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) {
		return;
	}
	let dp = PSURF * exp(state[GP + h]);
	state[DP + h] = dp;
	let scale = sqrt(tables[TABLE_RCSQ + h]);
	for (var l = 0u; l < NLEP; l++) {
		let at = l * NHOR + h;
		state[DUDT + at] = 0.0;
		state[DVDT + at] = 0.0;
		state[DTDT + at] = 0.0;
		state[DQDT + at] = 0.0;
		if (l < NLEV) {
			state[GUDT + at] = 0.0;
			state[GVDT + at] = 0.0;
			state[GTDT + at] = 0.0;
			state[GQDT + at] = 0.0;
			state[DU + at] = CV * state[GU + at] * scale;
			state[DV + at] = CV * state[GV + at] * scale;
			state[DT + at] = CT * (state[GT + at] + tables[TABLE_T0 + l]);
			state[DQ + at] = state[GQ + at] * PSURF / dp;
		}
	}
}
