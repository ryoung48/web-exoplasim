override SOURCE: u32;
override TARGET: u32;

@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let i = id.x;
	if (i >= THREADS) {
		return;
	}
	let k = i % NFC;
	let row = i / NFC;
	let grid = SOURCE + row * NLON;
	var sum = 0.0;
	for (var j = 0u; j < NLON; j++) {
		sum += tables[TABLE_FOURIER_FORWARD + j * NFC + k] * state[grid + j];
	}
	state[TARGET + row * NFC + k] = sum;
}
