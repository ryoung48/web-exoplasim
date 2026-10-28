override DELTSEC2: f32;
override GA: f32;
override GASCON: f32;
override ACPD: f32;
override ADV: f32;
override ALV: f32;
override ALS: f32;
override GAMMA: f32;

// The rest of rainstep after kuo, one column per thread: mkdca's
// adjustment (unless DCA_SKIP), mklsp, mkrain, mkclouds.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) {
		return;
	}
	if (state[DCA_SKIP] == 0.0) {
		for (var l = 0u; l < NLEV; l++) {
			state[at(DTDT, l, h)] = state[at(DTDT, l, h)] + state[at(DCA_DTDT, l, h)];
			state[at(DQDT, l, h)] = state[at(DQDT, l, h)] + state[at(DCA_DQDT, l, h)];
		}
	}
	mklsp(h);
	mkrain(h);
	mkclouds(h);
}
