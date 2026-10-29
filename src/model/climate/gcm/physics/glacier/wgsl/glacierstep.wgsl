override NGLACIER: bool;
override GLACELIM: f32;

// glaciermod's glacierstep, then glacierstop's promotion at each calendar
// year's end (SURFACE_STEP + 6), as ExoPlaSim's one-year Python sessions do:
// land that kept GLACELIM of snow all year becomes glacier, and persistence
// restarts as glacierini sets it.
fn glacierstep(h: u32) {
	if (!NGLACIER) {
		return;
	}
	let land = state[DLS + h] > 0.5;
	if (land && state[DSNOWZ + h] < GLACELIM) {
		state[DPERSIST + h] = 0.0;
	}
	if (land && state[DSNOWZ + h] < 0.1) {
		state[DGLAC + h] = 0.0;
	}
	if (state[SURFACE_STEP + 6u] > 0.5) {
		if (state[DPERSIST + h] > 0.5) {
			state[DGLAC + h] = 1.0;
		}
		state[DPERSIST + h] = select(0.0, 1.0, state[DLS + h] >= 0.5);
	}
}
