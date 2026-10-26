override PI: f32;
override TWOPI: f32;
// TWOPI / NLON: one longitude step in radians.
override ZRLON: f32;
// sin(dawn), the zenith-angle cosine below which a column is dark.
override ZDAWN: f32;

// radmod's solang (ncstsol = 0): the cosine of each column's solar zenith
// angle, from the declination and hour angle in RADIATION_STEP.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) {
		return;
	}
	let lat = h / NLON;
	let lon = h % NLON;
	var hangle = state[RADIATION_STEP + 2u] + f32(lon) * ZRLON - PI;
	if (hangle < -PI) {
		hangle = hangle + TWOPI;
	}
	if (hangle > PI) {
		hangle = hangle - TWOPI;
	}
	let muz = state[RADIATION_STEP] * tables[TABLE_SID + lat]
		+ tables[TABLE_COLA + lat] * state[RADIATION_STEP + 1u] * cos(hangle);
	state[GMU0 + h] = select(0.0, muz, muz > ZDAWN);
}
