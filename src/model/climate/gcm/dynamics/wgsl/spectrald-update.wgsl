override DELT2: f32;
override PNU: f32;
// nkits == 0: the leapfrog filter runs only after the start-up steps.
override FILTER: bool;

fn level(field: u32, l: u32, s: u32) -> u32 {
	return field + l * NRSP + s;
}

// spectrald after mkdheat: add the dissipative heating to stt, add the
// implicit tendencies, finish the time filter, publish sd/sz/st/sq/sp.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let s = id.x;
	if (s >= THREADS) {
		return;
	}
	let spp = state[SPP + s];
	if (FILTER) {
		state[SPM + s] = state[SPM + s] + PNU * spp;
	}
	state[SP + s] = spp;
	for (var l = 0u; l < NLEV; l++) {
		let stt = state[level(STT, l, s)] + state[level(ZSTT1, l, s)] + state[level(ZSTT2, l, s)];
		state[level(STT, l, s)] = stt;
		let szp = state[level(SZP, l, s)] + DELT2 * state[level(SZT, l, s)];
		let stp = state[level(STP, l, s)] + DELT2 * stt;
		let sdp = state[level(SDP, l, s)] + DELT2 * state[level(SDT, l, s)];
		let sqp = state[level(SQP, l, s)] + DELT2 * state[level(SQT, l, s)];
		state[level(SZP, l, s)] = szp;
		state[level(STP, l, s)] = stp;
		state[level(SDP, l, s)] = sdp;
		state[level(SQP, l, s)] = sqp;
		if (FILTER) {
			state[level(SZM, l, s)] = state[level(SZM, l, s)] + PNU * szp;
			state[level(STM, l, s)] = state[level(STM, l, s)] + PNU * stp;
			state[level(SDM, l, s)] = state[level(SDM, l, s)] + PNU * sdp;
			state[level(SQM, l, s)] = state[level(SQM, l, s)] + PNU * sqp;
		}
		state[level(SZ, l, s)] = szp;
		state[level(ST, l, s)] = stp;
		state[level(SD, l, s)] = sdp;
		state[level(SQ, l, s)] = sqp;
	}
}
