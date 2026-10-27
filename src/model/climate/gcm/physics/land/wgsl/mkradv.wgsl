// River water a point holds in the routing: driver · darea · dls.
fn river(h: u32) -> f32 {
	return state[DRIVER + h] * state[DAREA + h] * state[DLS + h];
}

struct Transfer {
	out: f32,
	into: f32,
}

// Eastward transfer from (row, lon) to its eastern neighbour: the upstream
// point's river water times the zonal runoff velocity, per unit area of
// the giving (out) and receiving (into) point.
fn eastward(row: u32, lon: u32) -> Transfer {
	let h = row + lon;
	let next = row + (lon + 1u) % NLON;
	let u = state[DUROFF + h];
	let water = select(river(next), river(h), u > 0.0);
	return Transfer(u * water / state[DAREA + h], u * water / state[DAREA + next]);
}

// landmod's mkradv: runoff routed one step along the river velocity field,
// eastward first (the Fortran loop's order of updates kept per point),
// then meridionally. Each thread writes only its own drunoff and reads
// only driver, so no point sees another's update.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) {
		return;
	}
	let lat = h / NLON;
	let lon = h % NLON;
	let row = lat * NLON;
	var runoff = state[DRUNOFF + h];
	if (lon == 0u) {
		runoff = runoff - eastward(row, 0u).out;
		runoff = runoff + eastward(row, NLON - 1u).into;
	} else {
		runoff = runoff + eastward(row, lon - 1u).into;
		runoff = runoff - eastward(row, lon).out;
	}
	let area = state[DAREA + h];
	let v = state[DVROFF + h];
	let below = select(0.0, river(h + NLON), lat + 1u < NLAT);
	if (v < 0.0) {
		runoff = runoff + v * river(h) / area;
	} else {
		runoff = runoff + v * below / area;
	}
	// What the row above sends south.
	var fromAbove = 0.0;
	if (lat > 0u) {
		let above = h - NLON;
		let va = state[DVROFF + above];
		fromAbove = select(-va * river(h), -va * river(above), va < 0.0);
	}
	state[DRUNOFF + h] = runoff + fromAbove / area;
}
