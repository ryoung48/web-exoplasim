// fix1d: a latitude whose columns together hold enough moisture covers its
// remaining deficit, one thread per row summing in longitude order.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let row = id.x;
	if (row >= THREADS) {
		return;
	}
	let first = row * NLON;
	var zneg = 0.0;
	for (var j = 0u; j < NLON; j++) {
		zneg = zneg + state[FIXNEG + first + j];
	}
	if (zneg <= 0.0) {
		return;
	}
	var zpos = 0.0;
	for (var j = 0u; j < NLON; j++) {
		zpos = zpos + state[FIXPOS + first + j];
	}
	if (zpos < zneg) {
		return;
	}
	let factor = (zpos - zneg) / zpos;
	for (var j = 0u; j < NLON; j++) {
		for (var l = 0u; l < NLEV; l++) {
			let at = FIXQ + l * NHOR + first + j;
			state[at] = max(state[at] * factor, 0.0);
		}
		state[FIXNEG + first + j] = 0.0;
		state[FIXPOS + first + j] = state[FIXPOS + first + j] * factor;
	}
}
