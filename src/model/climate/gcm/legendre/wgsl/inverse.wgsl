override SOURCE: u32;
override TARGET: u32;
override TABLE: u32;

// sp2fc and sp2fcdmu: each latitude's wavenumber m sums modes n = m..NTRU.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let i = id.x;
	if (i >= THREADS) {
		return;
	}
	let m = i % NTP1;
	let row = i / NTP1;
	let plane = row / NLAT;
	let lat = row % NLAT;
	let first = m * (2u * NTP1 - m + 1u) / 2u;
	let spectral = SOURCE + plane * NRSP;
	var re = 0.0;
	var im = 0.0;
	for (var w = first; w < first + NTP1 - m; w++) {
		let q = tables[TABLE + lat * NCSP + w];
		re += q * state[spectral + 2u * w];
		im += q * state[spectral + 2u * w + 1u];
	}
	state[TARGET + row * NFC + 2u * m] = re;
	state[TARGET + row * NFC + 2u * m + 1u] = im;
}
