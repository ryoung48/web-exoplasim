override XDT: f32;
override CLFSN: f32;
override THICEC: f32;

// icestep after getiflx's sums: the spread of excess-thickness heat, the
// binary ice cover (thicec), snow on vanished ice, then oceanstep
// (ncpl_ice_ocean = 1) and the outputs seastep copies back.
fn ice_finish(h: u32) {
	let xls = state[XLS + h];
	var xcflux = state[XCFLUX + h];
	var xcfluxr = state[XCFLUXR + h];
	let s1 = state[ICE_SUMS];
	let s2 = state[ICE_SUMS + 1u];
	if (s1 > 0.0 && s2 > 0.0 && xls < 1.0) {
		var zflx = state[ICE_ZFLX + h];
		let zfac = s1 / s2;
		if (zfac <= 1.0) {
			zflx = zflx * zfac;
		}
		xcfluxr = xcfluxr - zflx;
		xcflux = xcflux - zflx;
	}
	state[XCFLUXR + h] = xcfluxr;
	let xiced = state[XICED + h];
	let xicec = select(0.0, 1.0, state[XICEC + h] >= THICEC);
	var xsnow = state[XSNOW + h];
	var xsmelt = state[XSMELT + h];
	if (xiced <= 0.0 && xsnow > 0.0) {
		let zcflux = xsnow * 1000.0 * CLFSN / XDT;
		xsmelt = xsmelt + xsnow / XDT;
		state[XSMFLX + h] = state[XSMFLX + h] + zcflux;
		xcflux = xcflux - zcflux;
		xsnow = 0.0;
	}
	state[XICEC + h] = xicec;
	state[XSNOW + h] = xsnow;
	state[XSMELT + h] = xsmelt;
	state[XCFLUX + h] = xcflux;

	let sea = xls < 0.5;
	oceanstep(h, select(0.0, xcflux, sea));
	state[XOFLUX + h] = state[XOHEAT + h];
	if (sea) {
		state[XSNDCH + h] = state[XSNDCH + h] + (xsnow - state[ICE_SNOWOLD + h]);
	}
}
