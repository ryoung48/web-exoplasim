import { KERNEL } from "@/model/climate/gcm/kernel"
import type { GcmKernel } from "@/model/climate/gcm/kernel/types"
import type { GcmSumRequest } from "@/model/climate/gcm/reduction/types"
import sumCode from "@/model/climate/gcm/reduction/wgsl/sum.wgsl?raw"

// The deterministic global sum (plan DP2.4) that miscmod's fixer and
// icemod's getiflx share: one workgroup, fixed summation order.
function sum({
	context,
	label,
	first,
	second,
	target,
}: GcmSumRequest): Promise<GcmKernel> {
	const offset = (name: string) => context.state.slots[name].offset
	return KERNEL.pipeline({
		context,
		label,
		code: sumCode,
		constants: {
			THREADS: KERNEL.WORKGROUP_SIZE,
			FIRST: offset(first),
			SECOND: offset(second),
			TARGET: offset(target),
		},
	})
}

export const REDUCTION = {
	sum,
}
