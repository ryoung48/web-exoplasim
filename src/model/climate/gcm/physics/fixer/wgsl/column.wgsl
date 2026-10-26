// fixer's column sums and fix0d: the moisture each column lacks (zneg) and
// holds (zpos), weighted by dsigma, ps and the Gaussian weight; a column
// that can cover its own deficit is scaled and leaves no deficit.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) {
		return;
	}
	var negative = 0.0;
	var positive = 0.0;
	for (var l = 0u; l < NLEV; l++) {
		let q = state[DQ + l * NHOR + h] * tables[TABLE_DSIGMA + l];
		if (state[DQ + l * NHOR + h] < 0.0) {
			negative = negative + q;
		}
		if (state[DQ + l * NHOR + h] > 0.0) {
			positive = positive + q;
		}
	}
	var zneg = -negative * state[DP + h] * tables[TABLE_ZGW + h];
	var zpos = positive * state[DP + h] * tables[TABLE_ZGW + h];
	var factor = 1.0;
	let fixed = zneg > 0.0 && zpos >= zneg;
	if (fixed) {
		factor = (zpos - zneg) / zpos;
		zneg = 0.0;
		zpos = zpos * factor;
	}
	for (var l = 0u; l < NLEV; l++) {
		let q = state[DQ + l * NHOR + h];
		state[FIXQ + l * NHOR + h] = select(q, max(q * factor, 0.0), fixed);
	}
	state[FIXNEG + h] = zneg;
	state[FIXPOS + h] = zpos;
}
