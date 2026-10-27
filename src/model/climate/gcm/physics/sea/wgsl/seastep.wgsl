override TMELT: f32;
override RDBRV: f32;
override RA1: f32;
override RA2: f32;
override RA4: f32;
override GASCON: f32;
override GA: f32;
override CHARNOCK: f32;
override DZ0SEA: f32;
override DZ0ICE: f32;
override DRHSSEA: f32;
override DRHSICE: f32;
override ALBSEA: f32;
override ALBICE: f32;
override DOCEANALB1: f32;
override DOCEANALB2: f32;
override DICEALBMX1: f32;
override DICEALBMX2: f32;
override DICEALBMN1: f32;
override DICEALBMN2: f32;

fn at(field: u32, l: u32, h: u32) -> u32 {
	return field + l * NHOR + h;
}

// The end of icestep and seastep: ice_finish (with oceanstep), then the sea
// surface's state from the ice model, saturation humidity, Charnock
// roughness and the albedo of water and ice.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) {
		return;
	}
	ice_finish(h);
	if (!(state[DLS + h] < 0.5)) {
		return;
	}
	let dts = state[XTS + h];
	let dicec = state[XICEC + h];
	state[SEA_DSST + h] = state[XSST + h];
	state[SEA_DTS + h] = dts;
	state[DMLD + h] = state[XMLD + h];
	state[DICEC + h] = dicec;
	state[DICED + h] = state[XICED + h];
	state[DSNOW + h] = state[XSNOW + h];
	state[DSMELT + h] = state[XSMELT + h];
	state[DSNDCH + h] = state[XSNDCH + h];
	let dp = state[DP + h];
	state[at(DT, NLEV, h)] = dts;
	var dqs = precise_divide(RDBRV * RA1 * precise_exp(precise_divide(RA2 * (dts - TMELT), dts - RA4)), dp);
	dqs = precise_divide(dqs, 1.0 - (1.0 / RDBRV - 1.0) * dqs);
	state[SEA_DQS + h] = dqs;
	state[at(DQ, NLEV, h)] = dqs;
	let taux = state[DTAUX + h];
	let tauy = state[DTAUY + h];
	let zz0 = max(CHARNOCK * sqrt(taux * taux + tauy * tauy) * GASCON * dts / (GA * dp), DZ0SEA);
	state[DRHS + h] = DRHSSEA * (1.0 - dicec) + DRHSICE * dicec;
	state[DALB + h] = ALBSEA * (1.0 - dicec) + dicec * min(ALBICE, 0.5 + 0.025 * (273.0 - dts));
	state[DSALB + h] = DOCEANALB1 * (1.0 - dicec) + dicec * min(DICEALBMX1, DICEALBMN1 + 0.025 * (273.0 - dts));
	state[DSALB + NHOR + h] = DOCEANALB2 * (1.0 - dicec) + dicec * min(DICEALBMX2, DICEALBMN2 + 0.025 * (273.0 - dts));
	state[DZ0 + h] = zz0 * (1.0 - dicec) + DZ0ICE * dicec;
}
