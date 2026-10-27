// State offsets of the two grid fields summed and of the two-float result.
override FIRST: u32;
override SECOND: u32;
override TARGET: u32;

var<workgroup> firsts: array<f32, WORKGROUP_SIZE>;
var<workgroup> seconds: array<f32, WORKGROUP_SIZE>;

// Global sums of two grid fields in one workgroup: each thread sums a
// strided share in order, then a fixed-order tree combines the shares, so
// the result is the same every run.
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(local_invocation_index) thread: u32) {
	var first = 0.0;
	var second = 0.0;
	for (var h = thread; h < NHOR; h += WORKGROUP_SIZE) {
		first = first + state[FIRST + h];
		second = second + state[SECOND + h];
	}
	firsts[thread] = first;
	seconds[thread] = second;
	workgroupBarrier();
	for (var stride = WORKGROUP_SIZE / 2u; stride > 0u; stride /= 2u) {
		if (thread < stride) {
			firsts[thread] = firsts[thread] + firsts[thread + stride];
			seconds[thread] = seconds[thread] + seconds[thread + stride];
		}
		workgroupBarrier();
	}
	if (thread == 0u) {
		state[TARGET] = firsts[0];
		state[TARGET + 1u] = seconds[0];
	}
}
