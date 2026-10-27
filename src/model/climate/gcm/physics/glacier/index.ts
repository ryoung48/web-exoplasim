import glacierstepCode from "@/model/climate/gcm/physics/glacier/wgsl/glacierstep.wgsl?raw"

// glaciermod's per-step work; its state (dglac) is pumamod's.
export const GLACIER = {
	CODE: glacierstepCode,
}
