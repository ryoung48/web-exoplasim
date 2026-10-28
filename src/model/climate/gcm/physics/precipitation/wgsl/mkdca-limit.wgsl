var<workgroup> partial: array<f32, WORKGROUP_SIZE>;

// One workgroup: DCA_SKIP = 1 when any column's adjustment needed more than
// 2·NLEV passes, in which case mkdca changes nothing anywhere.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(local_invocation_index) i: u32) {
	var flag = 0.0;
	for (var h = i; h < NHOR; h += WORKGROUP_SIZE) {
		flag = max(flag, state[DCA_LIMITED + h]);
	}
	partial[i] = flag;
	workgroupBarrier();
	for (var stride = WORKGROUP_SIZE / 2u; stride > 0u; stride = stride / 2u) {
		if (i < stride) {
			partial[i] = max(partial[i], partial[i + stride]);
		}
		workgroupBarrier();
	}
	if (i == 0u) {
		state[DCA_SKIP] = partial[0];
	}
}
