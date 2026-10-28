override DTMIX: f32;
override CRHOS: f32;
override CPS: f32;
override TFREEZE: f32;

// oceanmod's oceanstep for the slab ocean (nocean = 1, one layer, nlsg = 0,
// nhdiff = 0, nfluko = 0): oceanget's climatological SST, then mksst and
// mkiflux. heat is the ice model's flux into the ocean. The y*a output
// accumulators and the copies only the LSG ocean reads (yicesnow and the
// other forcing fields) are not ported.
fn oceanstep(h: u32, heat: f32) {
	let weight = state[SURFACE_STEP + 5u];
	let a = state[at(YCLSST, u32(state[SURFACE_STEP + 3u]), h)];
	let b = state[at(YCLSST, u32(state[SURFACE_STEP + 4u]), h)];
	state[YCLSST2 + h] = (1.0 - weight) * a + weight * b;

	let yls = state[YLS + h];
	let yiced = state[XICED + h];
	let ymld = state[YMLD + h];
	let yfldo = state[YFLDO + h];
	let zcpsdt = DTMIX / (CRHOS * CPS);
	let ysst = state[YSST + h];
	var zsst = ysst;
	var yiflux = 0.0;
	if (yls < 1.0 && yiced <= 0.0) {
		zsst = zsst + (heat + yfldo) * zcpsdt / ymld;
	}
	if (yls < 1.0 && yiced > 0.0) {
		yiflux = yiflux - yfldo - heat;
	}
	// mkiflux: open water below freezing makes ice.
	if (ysst < TFREEZE && yls < 1.0) {
		yiflux = yiflux + (TFREEZE - zsst) * ymld / zcpsdt;
		zsst = TFREEZE;
	}
	// Under ice the mixed layer stays at freezing.
	if (yiced > 0.0 && yls < 1.0) {
		let zflx = (TFREEZE - zsst) * ymld / zcpsdt;
		zsst = zsst + zflx * zcpsdt / ymld;
		yiflux = yiflux + zflx;
	}
	state[YSST + h] = zsst;
	state[XSST + h] = zsst;
	state[XMLD + h] = ymld;
	state[XOHEAT + h] = -yiflux;
}
