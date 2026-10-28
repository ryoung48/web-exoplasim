// Snapshot order matches gcm_publish.f90. Unimplemented diagnostics keep
// reserved zero slots and are unavailable in GPU map controls.
override JET: u32;
override SIGMA: f32;

// ExoPlaSim's postprocessor: hfns = snow melt * L_TIMES_RHOH2O + rss + rls
// + hfss + hfls (pyburn.py).
const L_TIMES_RHOH2O: f32 = -333700000.0;

fn put(index: u32, h: u32, value: f32) {
	state[SNAPSHOT + index * NHOR + h] = value;
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let h = id.x;
	if (h >= THREADS) {
		return;
	}
	let step = u32(state[SNAPSHOT_STEP]);
	let steps_per_day = u32(state[SNAPSHOT_STEP + 1u]);
	let t = state[DTSA + h];
	let tracking = SNAPSHOT_TRACKING + h;
	if (state[tracking + 7u * NHOR] == 0.0) {
		state[tracking] = t;
		state[tracking + NHOR] = t;
		state[tracking + 7u * NHOR] = 1.0;
	}
	state[tracking] = min(state[tracking], t);
	state[tracking + NHOR] = max(state[tracking + NHOR], t);
	if (step > 0u) {
		if (state[tracking + 8u * NHOR] == 0.0) {
			state[tracking + 2u * NHOR] = t;
			state[tracking + 3u * NHOR] = t;
			state[tracking + 8u * NHOR] = 1.0;
			state[tracking + 9u * NHOR] = select(0.0, 1.0, (step - 1u) % steps_per_day == 0u);
		}
		state[tracking + 2u * NHOR] = min(state[tracking + 2u * NHOR], t);
		state[tracking + 3u * NHOR] = max(state[tracking + 3u * NHOR], t);
		if (step % steps_per_day == 0u) {
			if (state[tracking + 9u * NHOR] != 0.0) {
				let range = state[tracking + 3u * NHOR] - state[tracking + 2u * NHOR];
				state[tracking + 4u * NHOR] = range;
				state[tracking + 5u * NHOR] += range;
				state[tracking + 6u * NHOR] += 1.0;
			}
			state[tracking + 8u * NHOR] = 0.0;
		}
	}
	if (state[SNAPSHOT_STEP + 2u] == 0.0) {
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
	put(18u, h, -state[DEVAP + h]);
	put(19u, h, state[DRUNOFF + h]);
	put(20u, h, state[DFOREST + h]);
	put(21u, h, state[DLAI + h]);
	put(22u, h, state[DPRS + h]);
	put(23u, h, state[DSMELT + h]);
	put(24u, h, state[DICED + h]);
	put(25u, h, state[DGLAC + h]);
	put(27u, h, state[at(DSWFL, NLEV, h)]);
	put(28u, h, state[at(DLWFL, NLEV, h)]);
	put(29u, h, state[DSHFL + h]);
	put(30u, h, state[DLHFL + h]);
	put(31u, h, state[DPRC + h]);
	put(32u, h, state[DPRL + h]);
	put(33u, h, state[DSWFL + h]);
	put(34u, h, state[DLWFL + h]);
	put(35u, h, state[tracking]);
	put(36u, h, state[tracking + NHOR]);
	put(37u, h, state[tracking + 4u * NHOR]);
	put(38u, h, state[tracking + 5u * NHOR]);
	put(39u, h, state[tracking + 6u * NHOR]);
	state[tracking + 5u * NHOR] = 0.0;
	state[tracking + 6u * NHOR] = 0.0;
	state[tracking + 7u * NHOR] = 0.0;
	for (var l = 0u; l < NLEV; l++) {
		let field = 40u + 5u * l;
		put(field, h, state[at(DT, l, h)]);
		put(field + 1u, h, state[at(DU, l, h)]);
		put(field + 2u, h, state[at(DV, l, h)]);
		put(field + 4u, h, state[at(DCC, l, h)]);
	}
	let lowest = NLEV - 1u;
	let qsat = saturation_divided(state[at(DT, lowest, h)], state[DP + h] * SIGMA);
	put(40u + 5u * lowest + 3u, h, max(0.0, state[at(DQ, lowest, h)]) / max(1.17549435e-38, qsat));
}
