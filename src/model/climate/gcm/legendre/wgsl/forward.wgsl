override SOURCE: u32;
override TARGET: u32;
override TABLE: u32;

// fc2sp's single-process branch: mode (m, n) gathers north + south rows when
// m + n is even and north - south when odd, over the northern latitudes.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let i = id.x;
	if (i >= THREADS) {
		return;
	}
	let w = i % NCSP;
	let plane = i / NCSP;
	var m = 0u;
	var start = 0u;
	loop {
		if (w < start + NTP1 - m) {
			break;
		}
		start += NTP1 - m;
		m++;
	}
	let n = m + w - start;
	let sign = select(-1.0, 1.0, (m + n) % 2u == 0u);
	let fourier = SOURCE + plane * NLAT * NFC + 2u * m;
	var re = 0.0;
	var im = 0.0;
	for (var l = 0u; l < NLAT / 2u; l++) {
		let q = tables[TABLE + l * NCSP + w];
		let north = fourier + l * NFC;
		let south = fourier + (NLAT - 1u - l) * NFC;
		re += q * (state[north] + sign * state[south]);
		im += q * (state[north + 1u] + sign * state[south + 1u]);
	}
	state[TARGET + plane * NRSP + 2u * w] = re;
	state[TARGET + plane * NRSP + 2u * w + 1u] = im;
}
