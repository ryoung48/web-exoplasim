import type {
	GcmDynamicsKernels,
	GcmDynamicsPipeline,
	GcmDynamicsRequest,
	GcmDynamicsTable,
	GcmDynamicsTransfer,
	GcmDynamicsWinds,
	GcmFieldGroup,
} from "@/model/climate/gcm/dynamics/types"
import calcgpCode from "@/model/climate/gcm/dynamics/wgsl/calcgp.wgsl?raw"
import meanModeCode from "@/model/climate/gcm/dynamics/wgsl/mean-mode.wgsl?raw"
import mkdheatCode from "@/model/climate/gcm/dynamics/wgsl/mkdheat.wgsl?raw"
import spectralaCode from "@/model/climate/gcm/dynamics/wgsl/spectrala.wgsl?raw"
import diffusionCode from "@/model/climate/gcm/dynamics/wgsl/spectrald-diffusion.wgsl?raw"
import updateCode from "@/model/climate/gcm/dynamics/wgsl/spectrald-update.wgsl?raw"
import { FOURIER } from "@/model/climate/gcm/fourier"
import { KERNEL } from "@/model/climate/gcm/kernel"
import type { GcmKernel } from "@/model/climate/gcm/kernel/types"
import type {
	GcmDimensions,
	GcmFieldSpec,
} from "@/model/climate/gcm/layout/types"
import { LEGENDRE } from "@/model/climate/gcm/legendre"

const SPECTRAL_LEVELS = [
	...["sd", "st", "sz", "sq", "sdp", "stp", "szp", "sqp"],
	...["sdt", "stt", "szt", "sqt", "sdm", "stm", "szm", "sqm"],
	...["zsdpa", "zszpa", "zsdpb", "zszpb", "zstt1", "zstt2", "zsdef"],
]
const SPECTRAL_SURFACE = ["sp", "spp", "spt", "spm"]
const GRID_LEVELS = [
	...["gd", "gt", "gz", "gq", "gu", "gv", "dw"],
	...["gtn", "gqn", "guz", "gvz", "gke", "gut", "gvt", "guq", "gvq"],
	...["zu", "zv", "zun", "zvn", "zdtdt", "zdekin"],
]
const GRID_SURFACE = ["gp", "gpj", "gpmt", "gvpp", "dp0", "dp"]
const GRID_HALF_LEVELS = ["du0", "dv0", "dq"]
const FOURIER_LEVELS = [
	...["fgd", "fgt", "fgz", "fgq", "fgu", "fgv"],
	...["fgtn", "fgqn", "fguz", "fgvz", "fgke", "fgut", "fgvt", "fguq", "fgvq"],
	...["fzu", "fzv", "fzun", "fzvn", "fzdtdt", "fzdekin"],
]
const FOURIER_SURFACE = ["fgp", "fgpj", "fgpmt", "fgvpp"]

function group({ names, shape, count }: GcmFieldGroup): GcmFieldSpec[] {
	return names.map((name) => ({ name, shape, count }))
}

function fields(levels: number): GcmFieldSpec[] {
	return [
		...group({ names: SPECTRAL_LEVELS, shape: "spectral", count: levels }),
		...group({ names: SPECTRAL_SURFACE, shape: "spectral", count: 1 }),
		...group({ names: GRID_LEVELS, shape: "grid", count: levels }),
		...group({ names: GRID_SURFACE, shape: "grid", count: 1 }),
		...group({ names: GRID_HALF_LEVELS, shape: "grid", count: levels + 1 }),
		...group({ names: FOURIER_LEVELS, shape: "fourier", count: levels }),
		...group({ names: FOURIER_SURFACE, shape: "fourier", count: 1 }),
	]
}

// Constants initpm, initsi, makebm and the horizontal-diffusion setup
// compute, under their pumamod names.
const TABLES: GcmDynamicsTable[] = [
	...["t0", "dsigma", "sigmah", "rdsig", "t01s2", "tkp"].map((name) => ({
		name,
		count: ({ levels }: GcmDimensions) => levels,
	})),
	...["damp", "tdisst", "tdissq", "tdissd", "tdissz", "tfrc"].map((name) => ({
		name,
		count: ({ levels }: GcmDimensions) => levels,
	})),
	...["c", "g", "tau"].map((name) => ({
		name,
		count: ({ levels }: GcmDimensions) => levels * levels,
	})),
	{
		name: "bm1",
		count: ({ levels, truncation }) => levels * levels * truncation,
	},
	{
		name: "rcsq",
		count: ({ latitudes, longitudes }) => latitudes * longitudes,
	},
	...["nindex", "sop"].map((name) => ({
		name,
		count: ({ truncation }: GcmDimensions) =>
			(truncation + 1) * (truncation + 2),
	})),
	...["sakpp", "srp"].map((name) => ({
		name,
		count: ({ truncation, levels }: GcmDimensions) =>
			(truncation + 1) * (truncation + 2) * levels,
	})),
]

async function kernels({
	context,
	constants,
}: GcmDynamicsRequest): Promise<GcmDynamicsKernels> {
	const { latitudes, longitudes, truncation, levels } = context.state.dimensions
	const points = latitudes * longitudes
	const coefficients = (truncation + 1) * (truncation + 2)
	const offset = (name: string) => context.state.slots[name].offset
	const planes = (name: string) =>
		context.state.slots[name].floats / context.state.slots[name].planeFloats
	const pipeline = ({ label, code, values }: GcmDynamicsPipeline) =>
		KERNEL.pipeline({ context, label, code, constants: values })
	const transfer = ({ source, target }: GcmDynamicsTransfer) => ({
		context,
		source,
		target,
		planes: planes(source),
	})
	const toFourier = (fields: GcmDynamicsTransfer) =>
		LEGENDRE.inverse({ ...transfer(fields), table: "legendre_qi" })
	const toSpectral = (fields: GcmDynamicsTransfer) =>
		LEGENDRE.forward({ ...transfer(fields), table: "legendre_qc" })
	const toGrid = (fields: GcmDynamicsTransfer) =>
		FOURIER.inverse(transfer(fields))
	const fromGrid = (fields: GcmDynamicsTransfer) =>
		FOURIER.forward(transfer(fields))
	const winds = ({ divergence, vorticity, u, v }: GcmDynamicsWinds) =>
		LEGENDRE.dv2uv({
			context,
			divergence,
			vorticity,
			u,
			v,
			planes: levels,
			plavor: constants.plavor,
		})
	const mkdheat = (stage: number) =>
		pipeline({
			label: `mkdheat ${stage}`,
			code: mkdheatCode,
			values: {
				THREADS: levels * points,
				STAGE: stage,
				CV: constants.cv,
				CT: constants.ct,
				WW: constants.ww,
				GA: constants.ga,
				ACPD: constants.acpd,
				ADV: constants.adv,
				DELTSEC2: constants.deltsec2,
			},
		})
	const filter = constants.filter ? 1 : 0

	const gridpointa = [
		// invlega
		winds({ divergence: "sd", vorticity: "sz", u: "fgu", v: "fgv" }),
		...["d", "t", "z", "q", "p"].map((name) =>
			toFourier({ source: `s${name}`, target: `fg${name}` }),
		),
		LEGENDRE.inverse({
			...transfer({ source: "sp", target: "fgpj" }),
			table: "legendre_qj",
		}),
		FOURIER.dlambda(transfer({ source: "fgp", target: "fgpmt" })),
		...["u", "v", "t", "d", "z", "pj", "pmt", "p", "q"].map((name) =>
			toGrid({ source: `fg${name}`, target: `g${name}` }),
		),
		pipeline({
			label: "calcgp",
			code: calcgpCode,
			values: {
				THREADS: points,
				PSURF: constants.psurf,
				WW: constants.ww,
				CV: constants.cv,
				AKAP: constants.akap,
				RDBRV: constants.rdbrv,
				ADV: constants.adv,
			},
		}),
		...["tn", "qn", "ut", "vt", "uz", "vz", "ke", "vpp", "uq", "vq"].map(
			(name) => fromGrid({ source: `g${name}`, target: `fg${name}` }),
		),
		toSpectral({ source: "fgvpp", target: "spt" }),
		// mktend(sdf, stf, szf, gtn, gvz, guz, gke, gut, gvt): fu is gvz, fv is guz.
		...(await LEGENDRE.mktend({
			context,
			tn: "fgtn",
			fu: "fgvz",
			fv: "fguz",
			ke: "fgke",
			ut: "fgut",
			vt: "fgvt",
			d: "sdt",
			t: "stt",
			z: "szt",
			planes: levels,
		})),
		LEGENDRE.qtend({
			context,
			uFlux: "fguq",
			vFlux: "fgvq",
			source: "fgqn",
			target: "sqt",
			planes: levels,
		}),
	]
	const spectrala = [
		pipeline({
			label: "spectrala",
			code: spectralaCode,
			values: {
				THREADS: coefficients,
				DELT: constants.delt,
				DELT2: constants.delt2,
				PNU: constants.pnu,
				PNU21: constants.pnu21,
				FILTER: filter,
			},
		}),
	]
	const spectrald = [
		pipeline({
			label: "spectrald diffusion",
			code: diffusionCode,
			values: {
				THREADS: coefficients,
				DELT2: constants.delt2,
				PLAVOR: constants.plavor,
			},
		}),
		// mkdheat: winds before diffusion, after friction, after diffusion.
		winds({ divergence: "sdp", vorticity: "szp", u: "fzu", v: "fzv" }),
		toGrid({ source: "fzu", target: "zu" }),
		toGrid({ source: "fzv", target: "zv" }),
		winds({ divergence: "zsdpa", vorticity: "zszpa", u: "fzun", v: "fzvn" }),
		toGrid({ source: "fzun", target: "zun" }),
		toGrid({ source: "fzvn", target: "zvn" }),
		mkdheat(1),
		fromGrid({ source: "zdtdt", target: "fzdtdt" }),
		toSpectral({ source: "fzdtdt", target: "zstt1" }),
		winds({ divergence: "zsdpb", vorticity: "zszpb", u: "fzun", v: "fzvn" }),
		toGrid({ source: "fzun", target: "zun" }),
		toGrid({ source: "fzvn", target: "zvn" }),
		mkdheat(2),
		fromGrid({ source: "zdekin", target: "fzdekin" }),
		toSpectral({ source: "fzdekin", target: "zsdef" }),
		pipeline({
			label: "mean mode",
			code: meanModeCode,
			values: { THREADS: levels * coefficients, TARGET: offset("zsdef") },
		}),
		toFourier({ source: "zsdef", target: "fzdekin" }),
		toGrid({ source: "fzdekin", target: "zdekin" }),
		mkdheat(3),
		fromGrid({ source: "zdtdt", target: "fzdtdt" }),
		toSpectral({ source: "fzdtdt", target: "zstt2" }),
		pipeline({
			label: "spectrald update",
			code: updateCode,
			values: {
				THREADS: coefficients,
				DELT2: constants.delt2,
				PNU: constants.pnu,
				FILTER: filter,
			},
		}),
	]
	const [a, b, d] = await Promise.all(
		[gridpointa, spectrala, spectrald].map((list) => Promise.all(list)),
	)
	return { gridpointa: a, spectrala: b, spectrald: d } satisfies Record<
		string,
		GcmKernel[]
	>
}

export const DYNAMICS = {
	TABLES,
	fields,
	kernels,
}
