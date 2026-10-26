override U: u32;
override V: u32;
override KINETIC: u32;
override HAS_KINETIC: bool;
override DIVERGENCE: u32;
override VORTICITY: u32;

// uv2dv, and mktend's divergence and vorticity when HAS_KINETIC adds the
// kinetic energy term. S = north + s south and D = north - s south, with
// s = +1 for modes where m + n is even (symmetric) and -1 otherwise.
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
	var dre = 0.0;
	var dim = 0.0;
	var zre = 0.0;
	var zim = 0.0;
	for (var l = 0u; l < NLAT / 2u; l++) {
		let north = column + l * NFC;
		let south = column + (NLAT - 1u - l) * NFC;
		let qe = tables[TABLE_LEGENDRE_QE + l * NCSP + w];
		let qm = tables[TABLE_LEGENDRE_QM + l * NCSP + w];
		let dure = state[U + north] - s * state[U + south];
		let duim = state[U + north + 1u] - s * state[U + south + 1u];
		let dvre = state[V + north] - s * state[V + south];
		let dvim = state[V + north + 1u] - s * state[V + south + 1u];
		let sure = state[U + north] + s * state[U + south];
		let suim = state[U + north + 1u] + s * state[U + south + 1u];
		let svre = state[V + north] + s * state[V + south];
		let svim = state[V + north + 1u] + s * state[V + south + 1u];
		if (HAS_KINETIC) {
			let qq = tables[TABLE_LEGENDRE_QQ + l * NCSP + w];
			dre = dre + qq * (state[KINETIC + north] + s * state[KINETIC + south]);
			dim = dim + qq * (state[KINETIC + north + 1u] + s * state[KINETIC + south + 1u]);
		}
		dre = dre - qe * dvre - qm * suim;
		dim = dim - qe * dvim + qm * sure;
		zre = zre + qe * dure - qm * svim;
		zim = zim + qe * duim + qm * svre;
	}
	let at = plane * NRSP + 2u * w;
	state[DIVERGENCE + at] = dre;
	state[DIVERGENCE + at + 1u] = dim;
	state[VORTICITY + at] = zre;
	state[VORTICITY + at + 1u] = zim;
}
