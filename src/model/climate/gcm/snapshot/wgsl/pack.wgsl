// gcm_publish.f90's 18 surface fields, in GCM_FIELDS order, into the
// snapshot slot. JET is the level nearest sigma 0.25 (Fortran's jjet - 1).
override JET: u32;

// ExoPlaSim's postprocessor: hfns = snow melt * L_TIMES_RHOH2O + rss + rls
// + hfss + hfls (pyburn.py).
const L_TIMES_RHOH2O: f32 = -333700000.0;

fn at(field: u32, l: u32, h: u32) -> u32 {
	return field + l * NHOR + h;
}

fn put(index: u32, h: u32, value: f32) {
	state[SNAPSHOT + index * NHOR + h] = value;
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) {
		return;
	}
	put(0u, h, state[at(DT, NLEV, h)]);
	put(1u, h, state[DTSA + h]);
	put(2u, h, state[at(DU, NLEV - 1u, h)]);
	put(3u, h, state[at(DV, NLEV - 1u, h)]);
	put(4u, h, state[at(DCC, NLEV, h)]);
	put(5u, h, state[DPRC + h] + state[DPRL + h]);
	put(6u, h, state[DP + h]);
	put(7u, h, state[DQVI + h]);
	put(8u, h, state[DICEC + h]);
	put(9u, h, state[DSNOW + h]);
	put(10u, h, state[DWATC + h]);
	put(11u, h, state[DALB + h]);
	put(12u, h, state[at(DU, JET, h)]);
	put(13u, h, state[at(DV, JET, h)]);
	put(14u, h, -state[DLWFL + h]);
	put(15u, h, state[DLS + h]);
	put(16u, h, state[DSWFL + h] + state[DLWFL + h]);
	put(17u, h, state[DSMELT + h] * L_TIMES_RHOH2O + state[at(DSWFL, NLEV, h)] + state[at(DLWFL, NLEV, h)] + state[DSHFL + h] + state[DLHFL + h]);
}
