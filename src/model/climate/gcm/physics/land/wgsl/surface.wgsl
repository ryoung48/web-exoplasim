override DELTSEC: f32;
override TMELT: f32;
override RDBRV: f32;
override RA1: f32;
override RA2: f32;
override RA4: f32;
override ALBSMAX: f32;
override ALBSMIN: f32;
override ALBSMAXF: f32;
override ALBSMINF: f32;
override ALBSMAX1: f32;
override ALBSMIN1: f32;
override ALBSMAXF1: f32;
override ALBSMINF1: f32;
override ALBSMAX2: f32;
override ALBSMIN2: f32;
override ALBSMAXF2: f32;
override ALBSMINF2: f32;
override ALBGMAX: f32;
override ALBGMIN: f32;
override ALBGMAX1: f32;
override ALBGMIN1: f32;
override ALBGMAX2: f32;
override ALBGMIN2: f32;
override DRHSFULL: f32;
// nwetsoil: albedo of wet bare soil from the water bucket (page's wet
// soil option without a stellar spectrum).
override NWETSOIL: bool;
override WSMAX: f32;
override ALBLAND: f32;
override ALBLANDMAX: f32;
override DGROUNDALB1: f32;
override DGROUNDALB2: f32;
override DOCEANALB1: f32;
override DOCEANALB2: f32;

const NLSOIL = 5u;

fn at(field: u32, l: u32, h: u32) -> u32 {
	return field + l * NHOR + h;
}

// momint's month interpolation of a 0–13 climatology, weights from
// SURFACE_STEP (month, neighbour and weight at nstep + 1).
fn climatology(field: u32, h: u32) -> f32 {
	let weight = state[SURFACE_STEP + 5u];
	let a = state[at(field, u32(state[SURFACE_STEP + 3u]), h)];
	let b = state[at(field, u32(state[SURFACE_STEP + 4u]), h)];
	return (1.0 - weight) * a + weight * b;
}

// Snow albedo between its forest-weighted bounds, falling linearly from
// 263.16 K to TMELT.
fn snow_albedo(forest: f32, maxForest: f32, maxBare: f32, minForest: f32, minBare: f32, ts: f32) -> f32 {
	let zalbmax = forest * maxForest + (1.0 - forest) * maxBare;
	let zalbmin = forest * minForest + (1.0 - forest) * minBare;
	let zdalb = (zalbmax - zalbmin) * (ts - 263.16) / (TMELT - 263.16);
	return max(zalbmin, min(zalbmax, zalbmax - zdalb));
}

fn glacier_albedo(maxAlb: f32, minAlb: f32, ts: f32) -> f32 {
	return max(minAlb, min(maxAlb, maxAlb - (maxAlb - minAlb) * (ts - 263.16) / (TMELT - 263.16)));
}

// The rest of landstep after mkradv, then glacierstep: river storage,
// getalb's climatological albedo, the land surface's humidity, albedo and
// soil diagnostics, vegstep, glacier albedo.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) {
		return;
	}
	let dls = state[DLS + h];
	if (dls > 0.0) {
		state[DRIVER + h] = state[DRIVER + h] + state[DRUNOFF + h] * DELTSEC;
	}
	let dts = state[LAND_DTS + h];
	var albclim = climatology(DALBCL, h);
	var albclim1 = climatology(DALBCL1, h);
	var albclim2 = climatology(DALBCL2, h);
	if (NWETSOIL && dls > 0.5) {
		if (dts > 273.15) {
			let bf = state[DWATER + h] / WSMAX;
			let al = 1.0 / 5.2 * precise_pow(precise_pow(max(bf, 1.0e-3), (1.0 - 4.0) / 4.0) - 1.0, 1.0 / 4.0);
			let dry = precise_exp(-precise_powi(bf * 25.0, 6));
			let wet = precise_exp(-precise_powi((1.0 - bf) * 30.0, 9));
			albclim = ALBLANDMAX * dry + al * (1.0 - dry - wet) + DOCEANALB1 * wet;
			albclim1 = albclim;
			albclim2 = ALBLANDMAX * dry + al * (1.0 - dry - wet) + DOCEANALB2 * wet;
		} else {
			albclim = ALBLAND;
			albclim1 = DGROUNDALB1;
			albclim2 = DGROUNDALB2;
		}
	}
	state[DALBCLIM + h] = albclim;
	state[DALBCLIM1 + h] = albclim1;
	state[DALBCLIM2 + h] = albclim2;
	if (dls > 0.0) {
		state[LAND_DTSM + h] = dts;
		var dqs = precise_divide(RDBRV * RA1 * precise_exp(precise_divide(RA2 * (dts - TMELT), dts - RA4)), state[DP + h]);
		dqs = precise_divide(dqs, 1.0 - (1.0 / RDBRV - 1.0) * dqs);
		state[LAND_DQS + h] = dqs;
		let dsnow = state[DSNOWZ + h];
		state[DSNOW + h] = dsnow;
		if (dsnow > 0.0) {
			let forest = state[DFOREST + h];
			let snow = snow_albedo(forest, ALBSMAXF, ALBSMAX, ALBSMINF, ALBSMIN, dts);
			let snow1 = snow_albedo(forest, ALBSMAXF1, ALBSMAX1, ALBSMINF1, ALBSMIN1, dts);
			let snow2 = snow_albedo(forest, ALBSMAXF2, ALBSMAX2, ALBSMINF2, ALBSMIN2, dts);
			state[DALB + h] = albclim + (snow - albclim) * dsnow / (dsnow + 0.01);
			state[DSALB + h] = albclim1 + (snow1 - albclim1) * dsnow / (dsnow + 0.01);
			state[DSALB + NHOR + h] = albclim2 + (snow2 - albclim2) * dsnow / (dsnow + 0.01);
			state[DRHS + h] = 1.0;
		} else {
			state[DALB + h] = albclim;
			state[DSALB + h] = albclim1;
			state[DSALB + NHOR + h] = albclim2;
			let dwmax = state[DWMAX + h];
			if (dwmax > 0.0) {
				state[DRHS + h] = min(1.0, state[DWATC + h] / (DRHSFULL * dwmax));
			}
		}
		state[DTSOIL + h] = state[at(DSOILT, 0u, h)];
		state[DTD2 + h] = state[at(DSOILT, 1u, h)];
		state[DTD3 + h] = state[at(DSOILT, 2u, h)];
		state[DTD4 + h] = state[at(DSOILT, 3u, h)];
		state[DTD5 + h] = state[at(DSOILT, NLSOIL - 1u, h)];
		state[at(DT, NLEV, h)] = dts;
		state[at(DQ, NLEV, h)] = dqs;
	}
	if (NVEG > 0) {
		vegstep(h);
	}
	if (state[DGLAC + h] > 0.5 && dls > 0.0) {
		state[DALB + h] = glacier_albedo(ALBGMAX, ALBGMIN, dts);
		state[DSALB + h] = glacier_albedo(ALBGMAX1, ALBGMIN1, dts);
		state[DSALB + NHOR + h] = glacier_albedo(ALBGMAX2, ALBGMIN2, dts);
		state[DRHS + h] = 1.0;
	}
	glacierstep(h);
}
