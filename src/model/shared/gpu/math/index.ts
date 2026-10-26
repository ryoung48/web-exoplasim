import preciseCode from "@/model/shared/gpu/math/wgsl/precise.wgsl?raw"

// WGSL functions prepended to a kernel's code.
export const GPU_MATH = {
	PRECISE: preciseCode,
}
