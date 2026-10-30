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

const temperatureRangeStops = palette(
	"#0000aa",
	"#0050ff",
	"#00c8c8",
	"#28f050",
	"#b4ff00",
	"#ffff00",
	"#ffb400",
	"#ff4600",
	"#ff0000",
	"#aa0000",
)

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

const windStops = palette(
	"#e8fff1",
	"#c8f9dc",
	"#a4f3d0",
	"#78eadb",
	"#48d9e5",
	"#00cfe8",
)

const elevationLandStops = palette(
	"#acd0a5",
	"#94bf8b",
	"#a8c68f",
	"#bdcc96",
	"#d1d7ab",
	"#e1e4b5",
	"#efebc0",
	"#e8e1b6",
	"#ded6a3",
	"#d3ca9d",
	"#cab982",
	"#c3a76b",
	"#b9985a",
	"#aa8753",
	"#ac9a7c",
	"#baae9a",
	"#cac3b8",
	"#e0ded8",
	"#f5f4f2",
)

export const COLOR_PALETTES = {
	greensStops: palette("#f7fcf5", "#c7e9c0", "#74c476", "#238b45", "#00441b"),
	elevationLandStops,
	cloudStops,
	windStops,
	bupuStops,
	orangesStops,
	purplesStops,
	ylOrRdStops,
	plasmaStops,
	knowledgeStops,
	spectralStops,
	temperatureRangeStops,
}
