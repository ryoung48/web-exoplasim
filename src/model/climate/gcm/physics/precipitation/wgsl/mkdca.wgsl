override DELTSEC2: f32;

fn at(field: u32, l: u32, h: u32) -> u32 {
	return field + l * NHOR + h;
}

// rainmod's mkdca for one column: dry convective adjustment, mixing each
// unstable layer pair (and the stable layers above it that are colder than
// the mix) to a common potential temperature and humidity until the column
// is stable. Fortran repeats the pass for all columns together and drops
// every adjustment once 2·NLEV passes are not enough; DCA_LIMITED marks a
// column that needed more, and mkdca-limit combines the marks.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) {
		return;
	}
	var zt: array<f32, NLEV>;
	var zth: array<f32, NLEV>;
	var zq: array<f32, NLEV>;
	var zqn: array<f32, NLEV>;
	var skap: array<f32, NLEV>;
	var ds: array<f32, NLEV>;
	for (var l = 0u; l < NLEV; l++) {
		skap[l] = tables[TABLE_VDIFF_SKAP + l];
		ds[l] = tables[TABLE_DSIGMA + l];
		zt[l] = state[at(DT, l, h)] + state[at(DTDT, l, h)] * DELTSEC2;
		zth[l] = zt[l] / skap[l];
		zq[l] = state[at(DQ, l, h)] + state[at(DQDT, l, h)] * DELTSEC2;
		zqn[l] = zq[l];
	}
	// Levels no pass mixes keep their temperature: Fortran's round trip
	// through θ = T/σ^κ leaves f32 rounding noise there, f64 none.
	var mixed: array<bool, NLEV>;
	var limited = 0.0;
	var passes = 0u;
	loop {
		// Base and top under Fortran's 1-based level numbers.
		var unstable = false;
		var ibase = 0;
		var itop = i32(NLEV);
		var ztht = 0.0;
		var zqt = 0.0;
		var zsum1 = 0.0;
		var zsum2 = 0.0;
		var zsumq1 = 0.0;
		var zsumq2 = 0.0;
		for (var l = 0u; l < NLEM; l++) {
			let lp = l + 1u;
			if (zth[l] < zth[lp]) {
				ibase = i32(l) + 2;
				itop = i32(l);
				zsum1 = skap[lp] * ds[lp] + skap[l] * ds[l];
				zsum2 = skap[lp] * ds[lp] * zth[lp] + skap[l] * ds[l] * zth[l];
				zsumq1 = ds[lp] + ds[l];
				zsumq2 = ds[lp] * zqn[lp] + ds[l] * zqn[l];
				ztht = zsum2 / zsum1;
				zqt = zsumq2 / zsumq1;
				unstable = true;
			}
		}
		if (!unstable) {
			break;
		}
		for (var level = i32(NLEM) - 1; level >= 1; level--) {
			let l = u32(level - 1);
			if (itop == level && zth[l] < ztht) {
				itop = level - 1;
				zsum1 = zsum1 + skap[l] * ds[l];
				zsum2 = zsum2 + skap[l] * ds[l] * zth[l];
				zsumq1 = zsumq1 + ds[l];
				zsumq2 = zsumq2 + ds[l] * zqn[l];
				ztht = zsum2 / zsum1;
				zqt = zsumq2 / zsumq1;
			}
		}
		for (var l = 0u; l < NLEV; l++) {
			let level = i32(l) + 1;
			if (level > itop && level <= ibase) {
				zth[l] = ztht;
				zqn[l] = zqt;
				mixed[l] = true;
			}
		}
		passes = passes + 1u;
		if (passes > 2u * NLEV) {
			limited = 1.0;
			break;
		}
	}
	for (var l = 0u; l < NLEV; l++) {
		state[at(DCA_DTDT, l, h)] = select(0.0, (zth[l] * skap[l] - zt[l]) / DELTSEC2, mixed[l]);
		state[at(DCA_DQDT, l, h)] = (zqn[l] - zq[l]) / DELTSEC2;
	}
	state[DCA_LIMITED + h] = limited;
}
