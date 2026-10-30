override RD: f32;
override OMEGA: f32;
override CKCD: f32;
override VITHRESH: f32;

// hurricanemod.f90 at ExoPlaSim 5f8dff4, including its humidity convention.
const CPD: f32 = 1005.7;
const CL: f32 = 2500.0;
const RVP: f32 = 461.5;
const ALV0: f32 = 2.501e6;
const CPVMCL: f32 = -630.0;

struct Sounding {
	t: array<f32, NLEV>,
	r: array<f32, NLEV>,
	p: array<f32, NLEV>,
}
struct CapeRequest {
	sounding: Sounding,
	parcel: vec3f,
}
struct CapeResult {
	energy: f32,
	temperature: f32,
	pressure: f32,
}

fn es(tc: f32) -> f32 {
	return 6.112 * exp(17.67 * tc / (243.5 + tc));
}

// Inputs: mixing ratio, pressure.
fn vapor(v: vec2f) -> f32 {
	return v.x * v.y / (RD / RVP + v.x);
}

// Inputs: vapor pressure, total pressure.
fn mixing(v: vec2f) -> f32 {
	return (RD / RVP) * v.x / (v.y - v.x);
}

// Inputs: temperature, total water, vapor mixing ratio.
fn density(v: vec3f) -> f32 {
	return v.x * (1.0 + v.z / (RD / RVP)) / (1.0 + v.y);
}

// Inputs: temperature, mixing ratio, pressure.
fn entropy(v: vec3f) -> f32 {
	let e = vapor(v.yz);
	let rh = min(e / es(v.x - 273.15), 1.0);
	let lv = ALV0 + CPVMCL * (v.x - 273.15);
	let dry = (CPD + v.y * CL) * log(v.x) - RD * log(v.z - e);
	if (v.y == 0.0) { return dry; }
	return dry + lv * v.y / v.x - v.y * RVP * log(rh);
}

fn cape(input: CapeRequest) -> CapeResult {
	let s = input.sounding;
	let tp = input.parcel.x;
	let rp = input.parcel.y;
	let pp = input.parcel.z;
	if (rp < 1e-6 || tp < 200.0 || pp <= 0.0) {
		return CapeResult(0.0, -1.0, -1.0);
	}
	let rh = min(vapor(vec2f(rp, pp)) / es(tp - 273.15), 1.0);
	let parcel_entropy = entropy(input.parcel);
	let plcl = pp * pow(rh, tp / (1669.0 - 122.0 * rh - tp));
	var buoyancy: array<f32, NLEV>;
	// Native selects min(P - TOP * MSL), which is the topmost level.
	for (var level = i32(NLEV) - 1; level >= 0; level--) {
		let l = u32(level);
		var tg: f32;
		var rg = rp;
		if (s.p[l] >= plcl) {
			tg = tp * pow(s.p[l] / pp, RD / CPD);
		} else {
			var next = s.t[l];
			tg = 0.0;
			var count = 0u;
			loop {
				if (abs(next - tg) <= 0.001) { break; }
				tg = next;
				let tc = tg - 273.15;
				let enew = es(tc);
				rg = mixing(vec2f(enew, s.p[l]));
				count++;
				let lv = ALV0 + CPVMCL * tc;
				let sl = (CPD + rp * CL + lv * lv * rg / (RVP * tg * tg)) / tg;
				let em = vapor(vec2f(rg, s.p[l]));
				if (s.p[l] - em <= 0.0 || tg <= 0.0) {
					return CapeResult(0.0, s.t[l], -1.0);
				}
				let sg = (CPD + rp * CL) * log(tg) - RD * log(s.p[l] - em) + lv * rg / tg;
				next = tg + select(1.0, 0.3, count < 3u) * (parcel_entropy - sg) / sl;
				if (count > 500u || enew > s.p[l] - 1.0 || !(next > 0.0)) {
					return CapeResult(0.0, s.t[NLEV - 1u], s.p[NLEV - 1u]);
				}
			}
		}
		buoyancy[l] = density(vec3f(tg, rp, rg)) - density(vec3f(s.t[l], s.r[l], s.r[l]));
	}
	var inb = NLEV - 1u;
	for (var l = 0u; l < NLEV; l++) {
		if (buoyancy[l] > 0.0) { inb = min(inb, l); }
	}
	if (inb == NLEV - 1u) { return CapeResult(0.0, s.t[NLEV - 1u], 0.0); }
	var area = 0.0;
	for (var j = i32(NLEV) - 2; j >= i32(inb); j--) {
		let l = u32(j);
		area += RD * (buoyancy[l] + buoyancy[l + 1u]) * (s.p[l + 1u] - s.p[l]) / (s.p[l] + s.p[l + 1u]);
	}
	area += RD * (pp - s.p[NLEV - 1u]) / (pp + s.p[NLEV - 1u]) * buoyancy[NLEV - 1u];
	var tob = s.t[inb];
	var lnb = s.p[inb];
	if (inb > 0u) {
		lnb = (s.p[inb - 1u] * buoyancy[inb] - s.p[inb] * buoyancy[inb - 1u]) / (buoyancy[inb] - buoyancy[inb - 1u]);
		area += RD * buoyancy[inb] * (s.p[inb] - lnb) / (s.p[inb] + lnb);
		tob = (s.t[inb] * (lnb - s.p[inb - 1u]) + s.t[inb - 1u] * (s.p[inb] - lnb)) / (s.p[inb] - s.p[inb - 1u]);
	}
	return CapeResult(max(area, 0.0), tob, lnb);
}

// Real part of upstream's principal complex cube roots. Its explicit
// real/imaginary test returns zero at VI=0 and |VI|>=VITHRESH.
fn reduced(vi: f32) -> f32 {
	if (vi == 0.0 || abs(vi) >= VITHRESH) { return 0.0; }
	return 2.0 / sqrt(3.0) * cos(acos(-vi / VITHRESH) / 3.0);
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) { return; }
	var s: Sounding;
	let msl = state[DP + h] * 0.01;
	let sst = state[DT + NLEV * NHOR + h];
	var i600 = 0u;
	var i850 = 0u;
	var i200 = 0u;
	var cold = false;
	for (var l = 0u; l < NLEV; l++) {
		s.t[l] = state[DT + l * NHOR + h];
		s.r[l] = state[DQ + l * NHOR + h];
		s.p[l] = msl * tables[TABLE_SIGMA + l];
		cold = cold || s.t[l] <= 100.0;
		if (abs(tables[TABLE_SIGMA + l] - 0.6) < abs(tables[TABLE_SIGMA + i600] - 0.6)) { i600 = l; }
		if (abs(tables[TABLE_SIGMA + l] - 0.85) < abs(tables[TABLE_SIGMA + i850] - 0.85)) { i850 = l; }
		if (abs(tables[TABLE_SIGMA + l] - 0.2) < abs(tables[TABLE_SIGMA + i200] - 0.2)) { i200 = l; }
	}
	let bottom = NLEV - 1u;
	let lowwind = length(vec2f(state[DU + i850 * NHOR + h], state[DV + i850 * NHOR + h]));
	let highwind = length(vec2f(state[DU + i200 * NHOR + h], state[DV + i200 * NHOR + h]));
	let shear = abs(highwind - lowwind);
	let vort = state[GZ + i850 * NHOR + h] * OMEGA;
	var deficit = 1.0;
	if (s.r[i600] > 0.0 && s.r[bottom] > 0.0) {
		let smr = mixing(vec2f(es(s.t[i600] - 273.15), s.p[i600]));
		let sms = entropy(vec3f(s.t[i600], smr, s.p[i600]));
		let sme = entropy(vec3f(s.t[i600], min(s.r[i600], smr), s.p[i600]));
		let smb = entropy(vec3f(sst, state[DQ + NLEV * NHOR + h], msl));
		let smo = entropy(vec3f(sst, mixing(vec2f(es(sst - 273.15), msl)), msl));
		if (smo != smb) { deficit = (sms - sme) / (smo - smb); }
	}
	var environmental = CapeResult(-1.0, -1.0, -1.0);
	var vmax = -1.0;
	if (sst > 278.15 && !cold && msl > 0.0) {
		environmental = cape(CapeRequest(s, vec3f(s.t[bottom], s.r[bottom], s.p[bottom])));
		var pm = 970.0;
		var old = pm;
		var next = 0.0;
		var capem = 0.0;
		var capems = 0.0;
		var ratio = 1.0;
		var failed = false;
		var count = 0u;
		loop {
			if (abs(next - old) <= 0.5) { break; }
			let pp = min(pm, 1000.0);
			let rp = (RD / RVP) * s.r[bottom] * msl / (pp * (RD / RVP + s.r[bottom]) - s.r[bottom] * msl);
			capem = cape(CapeRequest(s, vec3f(s.t[bottom], rp, pp))).energy;
			let rs = mixing(vec2f(es(sst - 273.15), pp));
			let saturated = cape(CapeRequest(s, vec3f(sst, rs, pp)));
			capems = saturated.energy;
			ratio = sst / saturated.temperature;
			let tvav = 0.5 * (density(vec3f(s.t[bottom], s.r[bottom], s.r[bottom])) + density(vec3f(sst, rs, rs)));
			let cat = max((capem - environmental.energy) + 0.5 * CKCD * ratio * (capems - capem), 0.0);
			next = msl * exp(-cat / (RD * tvav));
			old = pm;
			pm = next;
			count++;
			if (count > 200u || pm < 400.0 || !(pm > 0.0)) { failed = true; break; }
		}
		if (!failed) { vmax = sqrt(max(0.0, CKCD * ratio * max(0.0, capems - capem))); }
	}
	var vi = 1.0;
	if (vmax > 0.0) { vi = shear * deficit / vmax; }
	let rh = vapor(vec2f(s.r[i600], s.p[i600])) / es(s.t[i600] - 273.15);
	let gpi = pow(abs(vort * 1e5), 1.5) * pow(rh * 2.0, 3.0) * (vmax / 70.0) * (vmax / 70.0) * (vmax / 70.0) / ((1.0 + 0.1 * shear) * (1.0 + 0.1 * shear));
	state[CAPEN + h] = environmental.energy;
	state[LNB + h] = environmental.pressure;
	state[MPOTI + h] = vmax;
	state[CHIM + h] = deficit;
	state[LAAV + h] = vort;
	state[VENTI + h] = vi;
	state[VRMPI + h] = reduced(vi);
	state[GPI + h] = gpi;
	state[SHEAR + h] = shear;
}
