override DELT2: f32;
override PSURF: f32;

// The fixer's global step, then its humidity tendency and the new dq.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) {
		return;
	}
	let zzneg = state[FIXSUM];
	let zzpos = state[FIXSUM + 1u];
	let dp = state[DP + h];
	for (var l = 0u; l < NLEV; l++) {
		let at = l * NHOR + h;
		var q = state[FIXQ + at];
		if (zzneg > 0.0) {
			q = max(q * ((zzpos - zzneg) / zzpos), 0.0);
		}
		state[GQDT + at] = state[GQDT + at] + dp * (q - state[DQ + at]) / DELT2 / PSURF;
		state[DQ + at] = q;
	}
}
