override U_FLUX: u32;
override V_FLUX: u32;
override SOURCE_TERM: u32;
override TARGET: u32;

// qtend, and mktend's temperature tendency: the divergence of a flux
// (U_FLUX, V_FLUX) plus a gridpoint source, in flux form. S and D as in
// uv2dv.wgsl.
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
	let s = select(-1.0, 1.0, (m + n) % 2u == 0u);
	let column = plane * NLAT * NFC + 2u * m;
	var re = 0.0;
	var im = 0.0;
	for (var l = 0u; l < NLAT / 2u; l++) {
		let north = column + l * NFC;
		let south = column + (NLAT - 1u - l) * NFC;
		let qe = tables[TABLE_LEGENDRE_QE + l * NCSP + w];
		let qc = tables[TABLE_LEGENDRE_QC + l * NCSP + w];
		let qm = tables[TABLE_LEGENDRE_QM + l * NCSP + w];
		re = re + qe * (state[V_FLUX + north] - s * state[V_FLUX + south])
			+ qc * (state[SOURCE_TERM + north] + s * state[SOURCE_TERM + south])
			+ qm * (state[U_FLUX + north + 1u] + s * state[U_FLUX + south + 1u]);
		im = im + qe * (state[V_FLUX + north + 1u] - s * state[V_FLUX + south + 1u])
			+ qc * (state[SOURCE_TERM + north + 1u] + s * state[SOURCE_TERM + south + 1u])
			- qm * (state[U_FLUX + north] + s * state[U_FLUX + south]);
	}
	state[TARGET + plane * NRSP + 2u * w] = re;
	state[TARGET + plane * NRSP + 2u * w + 1u] = im;
}
