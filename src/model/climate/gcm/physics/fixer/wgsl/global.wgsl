var<workgroup> negatives: array<f32, WORKGROUP_SIZE>;
var<workgroup> positives: array<f32, WORKGROUP_SIZE>;

// The fixer's global deficit and surplus in one workgroup: each thread sums
// a strided share in order, then a fixed-order tree combines the shares, so
// the result is the same every run.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(local_invocation_index) thread: u32) {
	var negative = 0.0;
	var positive = 0.0;
	for (var h = thread; h < NHOR; h += WORKGROUP_SIZE) {
		negative = negative + state[FIXNEG + h];
		positive = positive + state[FIXPOS + h];
	}
	negatives[thread] = negative;
	positives[thread] = positive;
	workgroupBarrier();
	for (var stride = WORKGROUP_SIZE / 2u; stride > 0u; stride /= 2u) {
		if (thread < stride) {
			negatives[thread] = negatives[thread] + negatives[thread + stride];
			positives[thread] = positives[thread] + positives[thread + stride];
		}
		workgroupBarrier();
	}
	if (thread == 0u) {
		state[FIXSUM] = negatives[0];
		state[FIXSUM + 1u] = positives[0];
	}
}
