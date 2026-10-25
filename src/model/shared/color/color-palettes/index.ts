import type { RgbColor } from "@/model/shared/color/color-palettes/types"

function hexToRgb(hex: string): RgbColor {
	const normalized = hex.replace("#", "")
	return [
		parseInt(normalized.slice(0, 2), 16) / 255,
		parseInt(normalized.slice(2, 4), 16) / 255,
		parseInt(normalized.slice(4, 6), 16) / 255,
	]
}

function palette(...stops: string[]): readonly RgbColor[] {
	return stops.map(hexToRgb)
}

const bupuStops = palette(
	"#f7fcfd",
	"#e0ecf4",
	"#bfd3e6",
	"#9ebcda",
	"#8c96c6",
	"#8c6bb1",
	"#88419d",
	"#810f7c",
	"#4d004b",
)

const orangesStops = palette(
	"#fff5eb",
	"#fee6ce",
	"#fdd0a2",
	"#fdae6b",
	"#fd8d3c",
	"#f16913",
	"#d94801",
	"#a63603",
	"#7f2704",
)

const purplesStops = palette(
	"#fcfbfd",
	"#efedf5",
	"#dadaeb",
	"#bcbddc",
	"#9e9ac8",
	"#807dba",
	"#6a51a3",
	"#54278f",
	"#3f007d",
)

const ylOrRdStops = palette(
	"#ffffcc",
	"#ffeda0",
	"#fed976",
	"#feb24c",
	"#fd8d3c",
	"#fc4e2a",
	"#e31a1c",
	"#bd0026",
	"#800026",
)

const plasmaStops = palette(
	"#0d0887",
	"#41049d",
	"#6a00a8",
	"#8f0da4",
	"#b12a90",
	"#cc4778",
	"#e16462",
	"#f2844b",
	"#fca636",
	"#fcce25",
	"#f0f921",
)

const knowledgeStops = plasmaStops.slice(1).toReversed()

const spectralStops = palette(
	"#5e4fa2",
	"#3288bd",
	"#66c2a5",
	"#abdda4",
	"#e6f598",
	"#ffffbf",
	"#fee08b",
	"#fdae61",
	"#f46d43",
	"#d53e4f",
	"#9e0142",
)

const cloudStops = palette(
	"#0b1d33",
	"#2c4a6b",
	"#7d93ab",
	"#c9d4df",
	"#f8fafc",
)

export const COLOR_PALETTES = {
	cloudStops,
	bupuStops,
	orangesStops,
	purplesStops,
	ylOrRdStops,
	plasmaStops,
	knowledgeStops,
	spectralStops,
}
