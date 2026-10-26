override GASCON: f32;
override GA: f32;
override A0O3: f32;
override A1O3: f32;
override ACO3: f32;
override BO3: f32;
override CO3: f32;
// exp(-bo3 / co3).
override ZCONST: f32;

const ZFO3 = 100.0 / 2.14;

fn at(field: u32, l: u32, h: u32) -> u32 {
	return field + l * NHOR + h;
}

// radmod's mko3 (no3 = 1): a synthetic ozone column distributed over the
// levels by a height profile, with a seasonal term in RADIATION_STEP.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) {
		return;
	}
	let sid = tables[TABLE_SID + h / NLON];
	let za = A0O3 + A1O3 * abs(sid) + ACO3 * sid * state[RADIATION_STEP + 4u];
	let dp = state[DP + h];
	var o3t = za;
	var zh = 0.0;
	for (var l = NLEV - 1u; l >= 1u; l--) {
		zh = zh - state[at(DT, l, h)] * GASCON / GA * tables[TABLE_RAD_LNSIG + l];
		let o3 = -(za + za * ZCONST) / (1.0 + precise_exp((zh - BO3) / CO3)) + o3t;
		state[at(DQO3, l, h)] = o3 * GA / (ZFO3 * tables[TABLE_DSIGMA + l] * dp);
		o3t = o3t - o3;
	}
	state[at(DQO3, 0u, h)] = o3t * GA / (ZFO3 * tables[TABLE_DSIGMA] * dp);
}
