override NGLACIER: bool;

// glaciermod's glacierstep: a glacier point whose snow drops below 0.1 m
// stops being glacier. glacelim's persistflag only feeds the annual
// glacier update, which is ported separately.
fn glacierstep(h: u32) {
	if (NGLACIER && state[DLS + h] > 0.5 && state[DSNOWZ + h] < 0.1) {
		state[DGLAC + h] = 0.0;
	}
}
