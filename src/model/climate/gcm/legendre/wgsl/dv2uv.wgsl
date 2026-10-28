override DIVERGENCE: u32;
override VORTICITY: u32;
override U: u32;
override V: u32;
override PLAVOR: f32;

// dv2uv: winds at every latitude from spectral divergence and vorticity,
// with the planetary vorticity removed from mode (0, 1).
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
	let d = DIVERGENCE + plane * NRSP;
	let z = VORTICITY + plane * NRSP;
	var ure = 0.0;
	var uim = 0.0;
	var vre = 0.0;
	var vim = 0.0;
	for (var w = first; w < first + NTP1 - m; w++) {
		let qu = tables[TABLE_LEGENDRE_QU + lat * NCSP + w];
		let qv = tables[TABLE_LEGENDRE_QV + lat * NCSP + w];
		let zre = select(state[z + 2u * w], state[z + 2u * w] - PLAVOR, w == 1u);
		let zim = state[z + 2u * w + 1u];
		let dre = state[d + 2u * w];
		let dim = state[d + 2u * w + 1u];
		ure = ure + qv * zre + qu * dim;
		uim = uim + qv * zim - qu * dre;
		vre = vre + qu * zim - qv * dre;
		vim = vim - qu * zre - qv * dim;
	}
	let at = row * NFC + 2u * m;
	state[U + at] = ure;
	state[U + at + 1u] = uim;
	state[V + at] = vre;
	state[V + at + 1u] = vim;
}
