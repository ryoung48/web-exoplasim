override DELT2: f32;
override PLAVOR: f32;

fn level(field: u32, l: u32, s: u32) -> u32 {
	return field + l * NRSP + s;
}

// spectrald up to mkdheat: add the diabatic tendencies, then implicit
// restoration, friction and biharmonic diffusion, keeping planetary
// vorticity (Re mode (0, 1), coefficient 2) free of both. Also writes the
// two partially updated states mkdheat converts to winds.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let s = id.x;
	if (s >= THREADS) {
		return;
	}
	if (s < 2u) {
		state[SPP + s] = 0.0;
	}
	for (var l = 0u; l < NLEV; l++) {
		let szp = state[level(SZP, l, s)] + DELT2 * state[level(SZT, l, s)];
		let stp = state[level(STP, l, s)] + DELT2 * state[level(STT, l, s)];
		let sdp = state[level(SDP, l, s)] + DELT2 * state[level(SDT, l, s)];
		let sqp = state[level(SQP, l, s)] + DELT2 * state[level(SQT, l, s)];
		let sakpp = tables[level(TABLE_SAKPP, l, s)];
		let damp = tables[TABLE_DAMP + l];
		let tdisst = tables[TABLE_TDISST + l];
		let tdissq = tables[TABLE_TDISSQ + l];
		let tdissd = tables[TABLE_TDISSD + l];
		let tdissz = tables[TABLE_TDISSZ + l];
		let tfrc = tables[TABLE_TFRC + l];
		let stt = ((-damp - tdisst * sakpp) * stp + damp * tables[level(TABLE_SRP, l, s)])
			/ (1.0 + DELT2 * (damp + tdisst * sakpp));
		let sqt = -tdissq * sakpp * sqp / (1.0 + DELT2 * tdissq * sakpp);
		let zsdt1 = -tfrc * sdp / (1.0 + DELT2 * tfrc);
		let zsdt2 = -tdissd * sakpp * sdp / (1.0 + DELT2 * tdissd * sakpp);
		var zszt1 = -tfrc * szp / (1.0 + DELT2 * tfrc);
		var zszt2 = -tdissz * sakpp * szp / (1.0 + DELT2 * tdissz * sakpp);
		var szt = zszt1 + zszt2;
		if (s == 2u) {
			zszt1 = zszt1 + PLAVOR * tfrc / (1.0 + DELT2 * tfrc);
			zszt2 = zszt2 + PLAVOR * tdissz * sakpp / (1.0 + DELT2 * tdissz * sakpp);
			szt = szt + PLAVOR * (tfrc / (1.0 + DELT2 * tfrc)
				+ tdissz * sakpp / (1.0 + DELT2 * tdissz * sakpp));
		}
		state[level(SZP, l, s)] = szp;
		state[level(STP, l, s)] = stp;
		state[level(SDP, l, s)] = sdp;
		state[level(SQP, l, s)] = sqp;
		state[level(STT, l, s)] = stt;
		state[level(SQT, l, s)] = sqt;
		state[level(SDT, l, s)] = zsdt1 + zsdt2;
		state[level(SZT, l, s)] = szt;
		state[level(ZSDPA, l, s)] = sdp + zsdt1 * DELT2;
		state[level(ZSZPA, l, s)] = szp + zszt1 * DELT2;
		state[level(ZSDPB, l, s)] = sdp + zsdt2 * DELT2;
		state[level(ZSZPB, l, s)] = szp + zszt2 * DELT2;
	}
}
