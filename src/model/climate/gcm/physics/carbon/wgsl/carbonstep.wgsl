override NCARBON: bool;
override NSUPPLY: bool;
override TIMEWEIGHT: f32;
override CO2EARTH: f32;
override BETA: f32;
override KACT: f32;
override PEARTH: f32;
override WMAX: f32;
override VEARTH: f32;
override PLARAD: f32;
override RAD_EARTHSQ: f32;

fn at(field: u32, l: u32, h: u32) -> u32 {
	return field + l * NHOR + h;
}

// carbonmod's carbonstep for one column: the year's mean precipitation,
// and on weathering steps (CARBON_STEP = 1, every `interval` steps) the
// silicate weathering rate of unfrozen land and its yearly means.
// carbonmod.f90 defines precipweath = 1 itself, so weathering scales with
// precipitation rather than the temperature-runoff law.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) {
		return;
	}
	let precip = (state[DPRC + h] + state[DPRL + h]) * 3.154e9;
	state[LOCALPRECIP + h] = precip;
	state[LOCALAVGPRECIP + h] = state[LOCALAVGPRECIP + h] + precip * TIMEWEIGHT;
	if (state[CARBON_STEP] == 0.0) {
		return;
	}
	let tsurf = state[at(DT, NLEV, h)];
	if (NCARBON) {
		var weathering = 0.0;
		if (state[DLS + h] > 0.5 && tsurf >= 273.15) {
			let pco2 = state[CO2] * state[DP + h] * 1.0e-5;
			weathering = precise_pow(pco2 / CO2EARTH, BETA) * precise_exp(KACT * (tsurf - 288.0))
				* precise_pow(precip / PEARTH, 0.65);
			if (NSUPPLY) {
				let wmaxp = max(WMAX / VEARTH, 2.0e-15);
				weathering = wmaxp * (1.0 - precise_exp(-weathering / wmaxp));
			}
		}
		state[LOCALWEATHERING + h] = weathering * (PLARAD * PLARAD) / (RAD_EARTHSQ * 0.29);
	}
	state[LOCALAVGTEMPS + h] = state[LOCALAVGTEMPS + h] + tsurf * TIMEWEIGHT;
	state[LOCALAVGWEATHER + h] = state[LOCALAVGWEATHER + h] + state[LOCALWEATHERING + h] * TIMEWEIGHT;
}
