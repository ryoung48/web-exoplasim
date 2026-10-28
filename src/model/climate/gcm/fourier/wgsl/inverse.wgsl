override SOURCE: u32;
override TARGET: u32;

@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let i = id.x;
	if (i >= THREADS) {
		return;
	}
	let j = i % NLON;
	let row = i / NLON;
	let coefficients = SOURCE + row * NFC;
	var sum = 0.0;
	for (var k = 0u; k < NFC; k++) {
		sum += tables[TABLE_FOURIER_INVERSE + k * NLON + j] * state[coefficients + k];
	}
	state[TARGET + row * NLON + j] = sum;
}
