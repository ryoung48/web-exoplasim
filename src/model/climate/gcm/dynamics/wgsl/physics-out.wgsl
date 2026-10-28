override PSURF: f32;
override CV: f32;
override CT: f32;
override WW: f32;

// gridpointd after the parameterizations: add the dimensional tendencies
// (dudt, dvdt, dtdt, dqdt) to the model-unit ones the schemes wrote
// directly (gudt, gvdt, gtdt, gqdt), per level and point.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let i = id.x;
	if (i >= THREADS) {
		return;
	}
	let h = i % NHOR;
	let scale = sqrt(tables[TABLE_RCSQ + h]);
	state[GUDT + i] = state[DUDT + i] / scale / CV / WW + state[GUDT + i];
	state[GVDT + i] = state[DVDT + i] / scale / CV / WW + state[GVDT + i];
	state[GTDT + i] = state[DTDT + i] / CT / WW + state[GTDT + i];
	state[GQDT + i] = state[DQDT + i] * state[DP + h] / WW / PSURF + state[GQDT + i];
}
