import { PASTA_HYDROLOGY } from "@/model/climate/classification/pasta/hydrology"
import { PASTA_PALETTE } from "@/model/climate/classification/pasta/palette"
import type {
	PastaCell,
	PastaClass,
	PastaClassLabel,
	PastaRatio,
	PastaSeason,
	PastaZone,
} from "@/model/climate/classification/pasta/types"

// Absolute-temperature thresholds and PET/soil fallback from Worldbuilding Pasta:
// https://worldbuildingpasta.blogspot.com/2025/03/beyond-koppen-geiger-climate.html
const CLASSES: PastaClass[] = []

function add(zone: PastaClassLabel) {
	CLASSES.push({ ...zone, color: PASTA_PALETTE.color(zone.code) })
}

add({ code: "Ocean", name: "Ocean" })
for (const [code, name] of [
	["Ofi", "Permanent frozen ocean"],
	["Ofd", "Seasonal frozen ocean"],
	["Ofg", "Dark seasonal frozen ocean"],
	["Og", "Dark ocean"],
	["Oc", "Cool ocean"],
	["Ot", "Tropical ocean"],
	["Oh", "Hot ocean"],
	["Or", "Torrid ocean"],
	["Oe", "Extraseasonal ocean"],
] as const)
	add({ code, name })

for (const [prefix, title] of [
	["Ah", "Desert"],
	["Ad", "Semidesert"],
]) {
	for (const [suffix, adjective] of [
		["a", "Warm"],
		["c", "Cold"],
		["h", "Hot"],
		["e", "Hyperseasonal"],
	] as const)
		add({
			code: prefix + suffix,
			name: `${adjective} ${title.toLowerCase()}`,
		})
}

const LAND_ZONES: [string, string][] = [
	["TUr", "Tropical rainforest"],
	["TUf", "Tropical forest"],
	["TUs", "Tropical moist savanna"],
	["TUA", "Tropical dry savanna"],
	["TQf", "Quasitropical forest"],
	["TQs", "Quasitropical moist savanna"],
	["TQA", "Quasitropical dry savanna"],
	["TF", "Tropical twilight"],
	["TG", "Tropical barren"],
	["CTf", "Subtropical forest"],
	["CTs", "Subtropical moist savanna"],
	["CDa", "Oceanic temperate"],
	["CDb", "Continental temperate"],
	["CEa", "Oceanic boreal"],
	["CEb", "Continental boreal"],
	["CEc", "Percontinental boreal"],
	["CMa", "Oceanic submediterranean"],
	["CMb", "Continental submediterranean"],
	["CAMa", "Oceanic mediterranean"],
	["CAMb", "Continental mediterranean"],
	["CAa", "Cool dry savanna"],
	["CAb", "Cold steppe"],
	["CFa", "Oceanic tundra"],
	["CFb", "Continental tundra"],
	["CG", "Cold barren"],
	["CI", "Ice sheet"],
	["HTf", "Supertropical forest"],
	["HTs", "Supertropical moist savanna"],
	["HDa", "Hot swelter"],
	["HDb", "Torrid swelter"],
	["HDc", "Boiling swelter"],
	["HMa", "Hot subparamediterranean"],
	["HMb", "Torrid subparamediterranean"],
	["HMc", "Boiling subparamediterranean"],
	["HAMa", "Hot paramediterranean"],
	["HAMb", "Torrid paramediterranean"],
	["HAMc", "Boiling paramediterranean"],
	["HAa", "Hot dry savanna"],
	["HAb", "Torrid steppe"],
	["HAc", "Boiling steppe"],
	["HFa", "Hot parch"],
	["HFb", "Torrid parch"],
	["HFc", "Boiling parch"],
	["HG", "Hot barren"],
	["ETf", "Extratropical forest"],
	["ETs", "Extratropical moist savanna"],
	["EDa", "Superseasonal extracontinental"],
	["EDb", "Hyperseasonal extracontinental"],
	["EMa", "Superseasonal subextramediterranean"],
	["EMb", "Hyperseasonal subextramediterranean"],
	["EAMa", "Superseasonal extramediterranean"],
	["EAMb", "Hyperseasonal extramediterranean"],
	["EAa", "Superseasonal dry savanna"],
	["EAb", "Hyperseasonal steppe"],
	["EFa", "Superseasonal pulse"],
	["EFb", "Hyperseasonal pulse"],
	["EG", "Extraseasonal barren"],
]
for (const [code, name] of LAND_ZONES) {
	const suffix = code.slice(1)
	const marginal = suffix.startsWith("F") || suffix === "G" || suffix === "I"
	add({ code, name })
	if (!marginal && !suffix.startsWith("M") && !suffix.startsWith("AM"))
		add({
			code: code + "p",
			name: name + " (pluvial)",
		})
}

const ids = new Map(CLASSES.map((zone, index) => [zone.code, index]))

function season({ values, interruptions, threshold }: PastaSeason): number {
	const barriers = values.map((value, month) => {
		if (value > 0 || interruptions[month] <= 0) return false
		let total = interruptions[month]
		let count = 1
		for (const direction of [-1, 1]) {
			for (let step = 1; count < values.length; step++) {
				const index = (month + direction * step + values.length) % values.length
				if (interruptions[index] <= 0) break
				total += interruptions[index]
				count++
			}
		}
		return count === values.length || total > threshold
	})
	const start = barriers.findIndex(Boolean)
	if (start < 0)
		return values.some((value) => value > 0) ? Number.POSITIVE_INFINITY : 0
	let best = 0
	let sum = 0
	for (let offset = 1; offset <= values.length; offset++) {
		const month = (start + offset) % values.length
		sum = barriers[month] ? 0 : sum + values[month]
		best = Math.max(best, sum)
	}
	return best
}

function longest(values: number[]): number {
	if (values.every((value) => value > 0)) return Number.POSITIVE_INFINITY
	return season({
		values,
		interruptions: values.map((value) => (value > 0 ? 0 : 1)),
		threshold: 0,
	})
}

function landZone(zone: PastaZone): string {
	const {
		boiling,
		min,
		max,
		growth,
		zeroGrowth,
		interruption,
		aridity,
		growthAridity,
		supply,
		evaporationRatio,
		ice,
	} = zone
	if (ice) return "CI"
	const torrid = boiling || max > 70
	const group =
		boiling || max >= 50 ? (min > 10 ? "H" : "E") : min > 10 ? "T" : "C"
	const winter = min >= -10 ? "a" : min >= -40 ? "b" : "c"
	const summer = boiling ? "c" : torrid ? "b" : "a"
	const extreme = min < -10 || torrid ? "b" : "a"
	const suffix =
		group === "C"
			? winter === "c"
				? "b"
				: winter
			: group === "H"
				? summer
				: extreme
	if (zeroGrowth < 50) return `${group}G`
	if (aridity < 0.2)
		return `A${aridity < 0.06 ? "h" : "d"}${min < -10 ? (torrid ? "e" : "c") : torrid ? "h" : "a"}`
	if (growth < 350 && interruption >= 1250)
		return group === "T" ? "TF" : `${group}F${suffix}`
	let code: string
	if (group === "T") {
		const prefix = interruption < 1250 ? "TU" : "TQ"
		code =
			prefix +
			(growthAridity < 0.5
				? "A"
				: prefix === "TU" && aridity >= 0.9
					? "r"
					: aridity >= 0.75
						? "f"
						: "s")
	} else if (growthAridity < 0.5)
		code = `${group}A${supply < 0.8 ? "M" : ""}${suffix}`
	else if (supply < 0.8) code = `${group}M${suffix}`
	else if (
		interruption < 1250 &&
		(group === "C"
			? winter === "a"
			: group === "H"
				? summer === "a"
				: extreme === "a")
	)
		code = `${group}T${aridity >= 0.75 ? "f" : "s"}`
	else if (group === "C") code = growth <= 1300 ? `CE${winter}` : `CD${suffix}`
	else code = `${group}D${suffix}`
	return evaporationRatio < (code === "TUr" ? 0.4 : 0.45) && ids.has(`${code}p`)
		? `${code}p`
		: code
}

function classify(cell: PastaCell): number {
	const {
		monthDays,
		temperature,
		rainfall,
		light,
		surfaceTemperature,
		seaIce,
		snow,
	} = cell
	const minimum = Math.min(...cell.minimum)
	const maximum = Math.max(...cell.maximum)
	const zero = temperature.map(
		(t, month) =>
			monthDays * Math.max(0, Math.min(20, t, 60 - t, light[month] / 10)),
	)
	const daily = temperature.map((t, month) =>
		Math.max(0, Math.min(20, t - 5, (50 - t) * 2, (light[month] - 20) / 10)),
	)
	const interruptions = zero.map((value) => Math.max(0, 15 * monthDays - value))
	if (!cell.land) {
		const coverage = cell.downscaled
			? seaIce.map((cover, month) =>
					Math.max(cover, Math.min(1, snow[month] / 10)),
				)
			: seaIce
		const oceanLight = longest(
			light.map((value) => monthDays * Math.min(20, Math.max(0, value / 10))),
		)
		const min = Math.min(...surfaceTemperature)
		const max = Math.max(...surfaceTemperature)
		const code =
			Math.min(...coverage) > 0.8
				? "Ofi"
				: Math.max(...coverage) > 0.2
					? oceanLight < 50
						? "Ofg"
						: "Ofd"
					: oceanLight < 50
						? "Og"
						: max > 60
							? "Or"
							: max > 40
								? min <= 18
									? "Oe"
									: "Oh"
								: min <= 18
									? "Oc"
									: "Ot"
		return ids.get(code) as number
	}
	const estimatedPotential =
		cell.hydrology?.potential ??
		temperature.map((t) => (Math.max(0, t) * 7 * monthDays) / 30)
	const actual =
		cell.hydrology?.actual ??
		PASTA_HYDROLOGY.evaporation({ rainfall, potential: estimatedPotential })
	// koppenpasta's Biome_Data raises PET to at least the evaporation.
	const potential = estimatedPotential.map((value, month) =>
		Math.max(value, actual[month]),
	)
	const sum = (values: number[]) =>
		values.reduce((total, value) => total + value, 0)
	const weighted = (values: number[]) =>
		sum(values.map((value, month) => value * daily[month]))
	const ratio = (values: PastaRatio) =>
		values.denominator > 0 ? values.numerator / values.denominator : 1
	const totalActual = sum(actual)
	const boiling = cell.maximum.some((t, month) => {
		if (t <= 0) return false
		const vaporPressurePa =
			t > 108.3
				? 10 ** (10.26509 - 1810.94 / (244.485 + t))
				: 10 ** (10.19621 - 1730.63 / (233.426 + t))
		return cell.pressureHpa[month] * 100 < vaporPressurePa
	})
	const code = landZone({
		boiling,
		min: minimum,
		max: maximum,
		growth: season({
			values: daily.map((value) => value * monthDays),
			interruptions,
			threshold: 1250,
		}),
		zeroGrowth: longest(zero),
		interruption: longest(interruptions),
		aridity: ratio({ numerator: totalActual, denominator: sum(potential) }),
		growthAridity: ratio({
			numerator: weighted(actual),
			denominator: weighted(potential),
		}),
		supply: ratio({
			numerator: weighted(rainfall) * 12,
			denominator: sum(daily) * totalActual,
		}),
		evaporationRatio: ratio({
			numerator: totalActual,
			denominator: sum(rainfall),
		}),
		ice: cell.downscaled
			? (Math.min(...snow) > 10 && maximum <= 0) ||
				(Math.max(...snow) > 10 && maximum < 0)
			: Math.min(...snow) > 10,
	})
	const id = ids.get(code)
	if (id === undefined) throw new Error(`Unknown Pasta zone: ${code}`)
	return id
}

export const PASTA = { CLASSES, classify }
