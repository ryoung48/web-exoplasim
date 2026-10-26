override TARGET: u32;

// mkdheat's zsdef(2:NESP,:) = 0: keep only Re mode (0, 0), the global mean.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let i = id.x;
	if (i >= THREADS) {
		return;
	}
	if (i % NRSP != 0u) {
		state[TARGET + i] = 0.0;
	}
}
