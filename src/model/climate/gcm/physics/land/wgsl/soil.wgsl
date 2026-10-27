override DELTSEC: f32;
override TMELT: f32;
override ALS: f32;
override ALV: f32;
override SICECAP: f32;
override SOILCAP: f32;
override SICEDIFF: f32;
override SOILDIFF: f32;
override SNOWCAP: f32;
override SNOWDIFF: f32;
override RHOSNOW: f32;
override DZTOP: f32;
override DSMAX: f32;

const NLSOIL = 5u;
// Snow deeper than this (m) insulates no further.
const ZSNOWMAX = 1.0;

fn at(field: u32, l: u32, h: u32) -> u32 {
	return field + l * NHOR + h;
}

// landmod's mktsoil: implicit heat diffusion through the soil layers with
// flux ftop into the top layer.
fn mktsoil(h: u32, ftop: f32, soilz: ptr<function, array<f32, NLSOIL>>, cap: ptr<function, array<f32, NLSOIL>>, diff: ptr<function, array<f32, NLSOIL>>) {
	var zdiff: array<f32, NLSOIL>;
	var zcap: array<f32, NLSOIL>;
	var zebs: array<f32, NLSOIL>;
	var ztn: array<f32, NLSOIL>;
	let n = NLSOIL - 1u;
	zdiff[n - 1u] = 2.0 * (*diff)[n] * (*diff)[n - 1u]
		/ ((*diff)[n] * (*soilz)[n - 1u] + (*diff)[n - 1u] * (*soilz)[n]);
	zcap[n] = (*cap)[n] * (*soilz)[n] / DELTSEC;
	zebs[n] = 1.0 / (zcap[n] + zdiff[n - 1u]);
	ztn[n] = zcap[n] * state[at(DSOILT, n, h)] * zebs[n];
	for (var l = n - 1u; l >= 1u; l--) {
		zdiff[l - 1u] = 2.0 * (*diff)[l] * (*diff)[l - 1u]
			/ ((*diff)[l] * (*soilz)[l - 1u] + (*diff)[l - 1u] * (*soilz)[l]);
		zcap[l] = (*cap)[l] * (*soilz)[l] / DELTSEC;
		zebs[l] = 1.0 / (zcap[l] + zdiff[l - 1u] + zdiff[l] * (1.0 - zdiff[l] * zebs[l + 1u]));
		ztn[l] = zebs[l] * (zcap[l] * state[at(DSOILT, l, h)] + zdiff[l] * ztn[l + 1u]);
	}
	zcap[0] = (*cap)[0] * (*soilz)[0] / DELTSEC;
	zebs[0] = 1.0 / (zcap[0] + zdiff[0] * (1.0 - zdiff[0] * zebs[1]));
	ztn[0] = zebs[0] * (zcap[0] * state[at(DSOILT, 0u, h)] + zdiff[0] * ztn[1] + ftop);
	for (var l = 1u; l < NLSOIL; l++) {
		ztn[l] = ztn[l] + zebs[l] * zdiff[l - 1u] * ztn[l - 1u];
	}
	let glacier = state[DGLAC + h] > 0.5;
	for (var l = 0u; l < NLSOIL; l++) {
		state[at(DSOILT, l, h)] = select(ztn[l], min(ztn[l], TMELT), glacier);
	}
}

struct SnowLayer {
	ctop: f32,
	soilz1: f32,
	diff1: f32,
	cap1: f32,
}

// The top soil layer merged with the snow pack: heat capacity of the top
// DZTOP metres, and conductivity and capacity of layer 1 with the snow
// below DZTOP added.
fn snow_layer(snowz: f32, cap0: f32, diff0: f32, soilz0: f32) -> SnowLayer {
	let zsntop = min(precise_divide(snowz * 1000.0, RHOSNOW), DZTOP);
	let ctop = precise_divide(cap0 * SNOWCAP * DZTOP, cap0 * zsntop + SNOWCAP * (DZTOP - zsntop));
	let zsnowz = min(precise_divide(snowz * 1000.0, RHOSNOW), ZSNOWMAX) - zsntop;
	let soilz1 = soilz0 + zsnowz;
	let diff1 = precise_divide(diff0 * SNOWDIFF * soilz1, SNOWDIFF * soilz0 + diff0 * zsnowz);
	let cap1 = precise_divide(cap0 * SNOWCAP * soilz1, cap0 * zsnowz + SNOWCAP * soilz0);
	return SnowLayer(ctop, soilz1, diff1, cap1);
}

// tands' implicit surface temperature: the top layer's heat content, the
// surface flux and conduction to soil layer 1. Every quotient is
// corrected: the surface temperature is a ratio of ~6·10⁴ to ~200 whose
// largest term divides by the constant DELTSEC, which plain WGSL division
// rounds the same way every time.
fn surface_temperature(layer: SnowLayer, dtsm: f32, flux: f32, soil1: f32) -> f32 {
	let conduction = 2.0 * layer.diff1;
	return precise_divide(
		precise_divide(layer.ctop * DZTOP * dtsm, DELTSEC) + flux + precise_divide(conduction * soil1, layer.soilz1),
		precise_divide(layer.ctop * DZTOP, DELTSEC) + precise_divide(conduction, layer.soilz1),
	);
}

// landmod's soilstep (nlandt = nlandw = 1): tands (snow, surface and soil
// temperature) and wandr (soil water and runoff) for one column.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) {
		return;
	}
	let dls = state[DLS + h];
	let land = dls > 0.0;
	let snowStart = state[DSNOWZ + h];
	var dwater = 0.0;
	var dsmelt = 0.0;
	if (snowStart == 0.0) {
		state[DSNOWT + h] = TMELT;
	}
	if (land) {
		let glac = state[DGLAC + h];
		var soilz: array<f32, NLSOIL>;
		var cap: array<f32, NLSOIL>;
		var diff: array<f32, NLSOIL>;
		for (var l = 0u; l < NLSOIL; l++) {
			cap[l] = SICECAP * glac + SOILCAP * (1.0 - glac);
			diff[l] = SICEDIFF * glac + SOILDIFF * (1.0 - glac);
			soilz[l] = tables[TABLE_DSOILZ + l];
		}
		let zhfla = state[DSHFL + h] + state[DLHFL + h] + state[at(DFLUX, NLEV, h)];
		let devap = state[DEVAP + h];
		var zdsnowz = 0.0;
		if (state[DPRS + h] > 0.0) {
			zdsnowz = state[DPRS + h];
		}
		if (snowStart > 0.0) {
			zdsnowz = zdsnowz + devap;
		}
		var zsnowz = max(0.0, snowStart + zdsnowz * DELTSEC);
		zdsnowz = (zsnowz - snowStart) / DELTSEC;
		dwater = devap + state[DPRL + h] + state[DPRC + h] - zdsnowz;
		var dsnowz = zsnowz;

		let dtsm = state[LAND_DTSM + h];
		let soil1 = state[at(DSOILT, 0u, h)];
		var layer = snow_layer(dsnowz, cap[0], diff[0], soilz[0]);
		var dts = surface_temperature(layer, dtsm, zhfla, soil1);
		var zhfls = 2.0 * layer.diff1 / layer.soilz1 * (dts - soil1);
		var zhflm = 0.0;
		// Snow melts at TMELT with the surplus heat.
		if (dsnowz > 0.0 && dts > TMELT) {
			dts = TMELT;
			zhflm = max(0.0, zhfla - layer.ctop * DZTOP * (dts - dtsm) / DELTSEC
				+ 2.0 * layer.diff1 * (soil1 - dts) / layer.soilz1);
			zsnowz = max(0.0, dsnowz - zhflm * DELTSEC / ((ALS - ALV) * 1000.0));
			zdsnowz = (zsnowz - dsnowz) / DELTSEC;
			zhflm = -zdsnowz * 1000.0 * (ALS - ALV);
			dsnowz = zsnowz;
			dsmelt = -zdsnowz;
			zhfls = 2.0 * layer.diff1 / layer.soilz1 * (dts - soil1);
			dwater = dwater - zdsnowz;
			layer = snow_layer(dsnowz, cap[0], diff[0], soilz[0]);
		}
		// All snow melted: the rest of the heat warms the surface.
		if (dsnowz == 0.0 && zhflm > 0.0) {
			dts = surface_temperature(layer, dtsm, zhfla - zhflm, soil1);
			zhfls = 2.0 * layer.diff1 / layer.soilz1 * (dts - soil1);
		}
		soilz[0] = layer.soilz1;
		cap[0] = layer.cap1;
		diff[0] = layer.diff1;
		mktsoil(h, zhfls, &soilz, &cap, &diff);
		if (dsnowz > 0.0) {
			state[DSNOWT + h] = dts;
		}
		if (DSMAX > 0.0 && dsnowz > DSMAX) {
			zdsnowz = (DSMAX - dsnowz) / DELTSEC;
			dsnowz = DSMAX;
			dwater = dwater - zdsnowz;
			dts = dts + zdsnowz * 1000.0 * (ALS - ALV) * DELTSEC / layer.ctop / DZTOP;
			dsmelt = dsmelt - zdsnowz;
		}
		state[DSNOWZ + h] = dsnowz;
		state[LAND_DTS + h] = dts;
		state[DSNDCH + h] = dsnowz - snowStart;
	} else {
		state[DSNDCH + h] = snowStart;
	}
	state[DWATER + h] = dwater;
	state[DSMELT + h] = dsmelt;

	// wandr: soil water bucket and its overflow.
	var drunoff = 0.0;
	if (land) {
		var dwatc = state[DWATC + h] + DELTSEC * dwater;
		let dwmax = state[DWMAX + h];
		drunoff = max(0.0, dwatc - dwmax) / DELTSEC;
		state[DWATC + h] = max(min(dwmax, dwatc), 0.0);
	}
	state[DRUNOFF + h] = drunoff;
}
