override PSURF: f32;
override WW: f32;
override CV: f32;
override AKAP: f32;
override RDBRV: f32;
override ADV: f32;

fn level(field: u32, l: u32, h: u32) -> u32 {
	return field + l * NHOR + h;
}

// gridpointa from gp = exp(gp) to the flux products, with calcgp in
// between, for one column. Statement order and grouping follow plasim.f90.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) {
		return;
	}
	let rcsq = tables[TABLE_RCSQ + h];
	let ps = exp(state[GP + h]);
	state[GP + h] = ps;
	let gpm = state[GPMT + h];
	let gpj = state[GPJ + h];
	var gu: array<f32, NLEV>;
	var gv: array<f32, NLEV>;
	var gt: array<f32, NLEV>;
	var gd: array<f32, NLEV>;
	var gz: array<f32, NLEV>;
	var gq: array<f32, NLEV>;
	var zvgpg: array<f32, NLEV>;
	var ztv1: array<f32, NLEV>;
	var ztv2: array<f32, NLEV>;
	for (var l = 0u; l < NLEV; l++) {
		gu[l] = state[level(GU, l, h)];
		gv[l] = state[level(GV, l, h)];
		gt[l] = state[level(GT, l, h)];
		gd[l] = state[level(GD, l, h)];
		gz[l] = state[level(GZ, l, h)];
		gq[l] = state[level(GQ, l, h)];
		zvgpg[l] = rcsq * (gu[l] * gpm + gv[l] * gpj);
		let zq = max(gq[l] / ps, 0.0);
		let t0 = tables[TABLE_T0 + l];
		let tvirt = (gt[l] + t0) * (1.0 + (1.0 / RDBRV - 1.0) * zq);
		ztv1[l] = tvirt - t0;
		ztv2[l] = tvirt / (1.0 + ADV * zq) - t0;
	}

	var zsdotp: array<f32, NLEM>;
	var zsumd = tables[TABLE_DSIGMA] * gd[0];
	var gvp = tables[TABLE_DSIGMA] * zvgpg[0];
	zsdotp[0] = zsumd + gvp;
	for (var l = 1u; l < NLEV - 1u; l++) {
		zsumd = zsumd + tables[TABLE_DSIGMA + l] * gd[l];
		gvp = gvp + tables[TABLE_DSIGMA + l] * zvgpg[l];
		zsdotp[l] = zsumd + gvp;
	}
	zsumd = zsumd + tables[TABLE_DSIGMA + NLEV - 1u] * gd[NLEV - 1u];
	gvp = gvp + tables[TABLE_DSIGMA + NLEV - 1u] * zvgpg[NLEV - 1u];

	var gtd: array<f32, NLEM>;
	var gqm: array<f32, NLEM>;
	var gud: array<f32, NLEM>;
	var gvd: array<f32, NLEM>;
	for (var l = 0u; l < NLEM; l++) {
		zsdotp[l] = tables[TABLE_SIGMAH + l] * (zsumd + gvp) - zsdotp[l];
		gtd[l] = zsdotp[l] * (gt[l + 1u] - gt[l]);
		gqm[l] = zsdotp[l] * (gq[l + 1u] + gq[l]);
		gud[l] = zsdotp[l] * (gu[l + 1u] - gu[l]);
		gvd[l] = zsdotp[l] * (gv[l + 1u] - gv[l]);
	}

	var gtn: array<f32, NLEV>;
	var gqn: array<f32, NLEV>;
	var guz: array<f32, NLEV>;
	var gvz: array<f32, NLEV>;
	var dw: array<f32, NLEV>;
	zsumd = zvgpg[0] * tables[TABLE_DSIGMA];
	let rdsig0 = tables[TABLE_RDSIG];
	gtn[0] = gt[0] * gd[0] - AKAP * ztv2[0] * gd[0]
		- rdsig0 * (gtd[0] + tables[TABLE_T01S2] * (tables[TABLE_SIGMAH] * gvp - zsumd));
	gqn[0] = -rdsig0 * gqm[0];
	guz[0] = -gu[0] * gz[0] - gpj * ztv1[0] - rdsig0 * gvd[0];
	gvz[0] = gv[0] * gz[0] - gpm * ztv1[0] - rdsig0 * gud[0];
	dw[0] = gd[0] * ps * PSURF * WW;

	for (var l = 1u; l < NLEV; l++) {
		let column = l * NLEV;
		var ztpta = tables[TABLE_C + column] * zvgpg[0];
		var ztptb = tables[TABLE_C + column] * (zvgpg[0] + gd[0]);
		for (var j = 1u; j <= l; j++) {
			ztpta = ztpta + tables[TABLE_C + column + j] * zvgpg[j];
			ztptb = ztptb + tables[TABLE_C + column + j] * (zvgpg[j] + gd[j]);
		}
		let rdsig = tables[TABLE_RDSIG + l];
		let t01s2 = tables[TABLE_T01S2 + l];
		let t01s2m = tables[TABLE_T01S2 + l - 1u];
		let sigmah = tables[TABLE_SIGMAH + l];
		let sigmahm = tables[TABLE_SIGMAH + l - 1u];
		let tkp = tables[TABLE_TKP + l];
		if (l < NLEV - 1u) {
			zsumd = zsumd + zvgpg[l] * tables[TABLE_DSIGMA + l];
			gtn[l] = gt[l] * gd[l]
				+ AKAP * ztv2[l] * (zvgpg[l] - ztptb)
				+ tkp * (zvgpg[l] - ztpta)
				- rdsig * (gtd[l] + gtd[l - 1u]
					+ gvp * (t01s2 * sigmah + t01s2m * sigmahm)
					- zsumd * (t01s2m + t01s2)
					+ zvgpg[l] * tables[TABLE_DSIGMA + l] * t01s2m);
			gqn[l] = -rdsig * (gqm[l] - gqm[l - 1u]);
			guz[l] = -gu[l] * gz[l] - gpj * ztv1[l] - rdsig * (gvd[l] + gvd[l - 1u]);
			gvz[l] = gv[l] * gz[l] - gpm * ztv1[l] - rdsig * (gud[l] + gud[l - 1u]);
		} else {
			gtn[l] = gt[l] * gd[l]
				+ AKAP * ztv2[l] * (zvgpg[l] - ztptb)
				+ tkp * (zvgpg[l] - ztpta)
				- rdsig * (gtd[NLEM - 1u] + t01s2m * (sigmahm * gvp - zsumd));
			gqn[l] = rdsig * gqm[NLEM - 1u];
			guz[l] = -gu[l] * gz[l] - gpj * ztv1[l] - rdsig * gvd[NLEM - 1u];
			gvz[l] = gv[l] * gz[l] - gpm * ztv1[l] - rdsig * gud[NLEM - 1u];
		}
		dw[l] = (zvgpg[l] - ztptb) * ps * PSURF * WW;
	}

	let scale = sqrt(rcsq);
	for (var l = 0u; l < NLEV; l++) {
		var gsum = 0.0;
		for (var k = 0u; k < NLEV; k++) {
			gsum = gsum + tables[TABLE_G + l * NLEV + k] * (ztv1[k] - gt[k]);
		}
		let gphi = gsum * 2.0 / rcsq;
		state[level(GTN, l, h)] = gtn[l];
		state[level(GQN, l, h)] = gqn[l];
		state[level(GUZ, l, h)] = guz[l];
		state[level(GVZ, l, h)] = gvz[l];
		state[level(DW, l, h)] = dw[l];
		state[level(GUT, l, h)] = gu[l] * gt[l];
		state[level(GVT, l, h)] = gv[l] * gt[l];
		state[level(GKE, l, h)] = gu[l] * gu[l] + gv[l] * gv[l] + gphi;
		state[level(GUQ, l, h)] = gu[l] * gq[l];
		state[level(GVQ, l, h)] = gv[l] * gq[l];
		state[level(DU0, l, h)] = CV * gu[l] * scale;
		state[level(DV0, l, h)] = CV * gv[l] * scale;
	}
	state[GVPP + h] = gvp;
	state[DP0 + h] = PSURF * ps;
}
