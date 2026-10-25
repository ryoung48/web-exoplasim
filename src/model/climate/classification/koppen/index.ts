import type { KoppenCellsParams } from "@/model/climate/classification/koppen/types"

const KOPPEN_CLASSES = [
	{
		code: "Ocean",
		name: "Ocean",
		color: [0.29, 0.44, 0.65] as [number, number, number],
	},
	{
		code: "Af",
		name: "Tropical rainforest",
		color: [0.0, 0.0, 1.0] as [number, number, number],
	},
	{
		code: "Am",
		name: "Tropical monsoon",
		color: [0.0, 0.47, 1.0] as [number, number, number],
	},
	{
		code: "Aw",
		name: "Tropical savanna",
		color: [0.27, 0.67, 0.98] as [number, number, number],
	},
	{
		code: "BWh",
		name: "Hot desert",
		color: [1.0, 0.0, 0.0] as [number, number, number],
	},
	{
		code: "BWk",
		name: "Cold desert",
		color: [1.0, 0.59, 0.59] as [number, number, number],
	},
	{
		code: "BSh",
		name: "Hot steppe",
		color: [0.96, 0.65, 0.0] as [number, number, number],
	},
	{
		code: "BSk",
		name: "Cold steppe",
		color: [1.0, 0.86, 0.39] as [number, number, number],
	},
	{
		code: "Cfa",
		name: "Humid subtropical",
		color: [0.78, 1.0, 0.31] as [number, number, number],
	},
	{
		code: "Cfb",
		name: "Oceanic",
		color: [0.39, 1.0, 0.31] as [number, number, number],
	},
	{
		code: "Cfc",
		name: "Subpolar oceanic",
		color: [0.2, 0.78, 0.0] as [number, number, number],
	},
	{
		code: "Csa",
		name: "Hot-summer Mediterranean",
		color: [1.0, 1.0, 0.0] as [number, number, number],
	},
	{
		code: "Csb",
		name: "Warm-summer Mediterranean",
		color: [0.78, 0.78, 0.0] as [number, number, number],
	},
	{
		code: "Csc",
		name: "Cold-summer Mediterranean",
		color: [0.59, 0.59, 0.0] as [number, number, number],
	},
	{
		code: "Cwa",
		name: "Humid subtropical (monsoon)",
		color: [0.59, 1.0, 0.59] as [number, number, number],
	},
	{
		code: "Cwb",
		name: "Subtropical highland",
		color: [0.39, 0.78, 0.39] as [number, number, number],
	},
	{
		code: "Cwc",
		name: "Cold subtropical highland",
		color: [0.2, 0.59, 0.2] as [number, number, number],
	},
	{
		code: "Dfa",
		name: "Hot-summer continental",
		color: [0.0, 1.0, 1.0] as [number, number, number],
	},
	{
		code: "Dfb",
		name: "Warm-summer continental",
		color: [0.22, 0.78, 1.0] as [number, number, number],
	},
	{
		code: "Dfc",
		name: "Subarctic",
		color: [0.0, 0.49, 0.49] as [number, number, number],
	},
	{
		code: "Dfd",
		name: "Extremely cold subarctic",
		color: [0.0, 0.27, 0.37] as [number, number, number],
	},
	{
		code: "Dsa",
		name: "Hot-summer continental (dry summer)",
		color: [0.9, 0.5, 1.0] as [number, number, number],
	},
	{
		code: "Dsb",
		name: "Warm-summer continental (dry summer)",
		color: [0.7, 0.35, 0.85] as [number, number, number],
	},
	{
		code: "Dsc",
		name: "Subarctic (dry summer)",
		color: [0.5, 0.2, 0.65] as [number, number, number],
	},
	{
		code: "Dsd",
		name: "Extremely cold subarctic (dry summer)",
		color: [0.35, 0.1, 0.45] as [number, number, number],
	},
	{
		code: "Dwa",
		name: "Hot-summer continental (monsoon)",
		color: [0.67, 0.69, 1.0] as [number, number, number],
	},
	{
		code: "Dwb",
		name: "Warm-summer continental (monsoon)",
		color: [0.43, 0.47, 0.78] as [number, number, number],
	},
	{
		code: "Dwc",
		name: "Subarctic (monsoon)",
		color: [0.29, 0.31, 0.78] as [number, number, number],
	},
	{
		code: "Dwd",
		name: "Extremely cold subarctic (monsoon)",
		color: [0.2, 0.0, 0.53] as [number, number, number],
	},
	{
		code: "ET",
		name: "Tundra",
		color: [0.7, 0.7, 0.7] as [number, number, number],
	},
	{
		code: "EF",
		name: "Ice cap",
		color: [0.41, 0.41, 0.41] as [number, number, number],
	},
] as const

const koppenLabels = KOPPEN_CLASSES.map(
	(entry) => entry.code,
) as ReadonlyArray<string>

const CLASS_ID: Record<string, number> = Object.fromEntries(
	KOPPEN_CLASSES.map((entry, index) => [entry.code, index]),
)

function koppenCells({
	start,
	end,
	isLand,
	temperatureMonthly,
	rainfallMonthly,
	classes,
}: KoppenCellsParams): void {
	const N = isLand.length
	// Reusable buffers, avoiding per-cell allocations
	const mTemps = new Float64Array(12)
	const mRain = new Float64Array(12)

	for (let r = start; r < end; r++) {
		if (!isLand[r]) continue

		// Single-pass stats collection
		let hot = -Infinity,
			cold = Infinity,
			tempSum = 0
		let rainSum = 0,
			driestMonth = Infinity
		let monthsAbove10 = 0
		let nhSummerTempSum = 0,
			nhWinterTempSum = 0
		for (let month = 0; month < 12; month++) {
			const t = temperatureMonthly[month * N + r]
			const rain = rainfallMonthly[month * N + r]
			mTemps[month] = t
			mRain[month] = rain
			if (t > hot) hot = t
			if (t < cold) cold = t
			tempSum += t
			rainSum += rain
			if (rain < driestMonth) driestMonth = rain
			if (t >= 10) monthsAbove10++
			// NH summer = months 4-9, NH winter = 0-3,10,11
			if (month >= 4 && month <= 9) nhSummerTempSum += t
			else nhWinterTempSum += t
		}
		const annualTemp = tempSum / 12
		const annualRain = rainSum

		// Inline local season determination + driest/wettest computation
		const isNH = nhSummerTempSum >= nhWinterTempSum
		const s0 = isNH ? 5 : 11,
			s1 = isNH ? 6 : 0,
			s2 = isNH ? 7 : 1
		const w0 = isNH ? 11 : 5,
			w1 = isNH ? 0 : 6,
			w2 = isNH ? 1 : 7
		const sr0 = mRain[s0],
			sr1 = mRain[s1],
			sr2 = mRain[s2]
		const wr0 = mRain[w0],
			wr1 = mRain[w1],
			wr2 = mRain[w2]
		const summerRain = sr0 + sr1 + sr2
		const driestSummer = Math.min(sr0, sr1, sr2)
		const driestWinter = Math.min(wr0, wr1, wr2)
		const wettestSummer = Math.max(sr0, sr1, sr2)
		const wettestWinter = Math.max(wr0, wr1, wr2)
		const summerFrac = annualRain > 0 ? summerRain / annualRain : 0.5

		// E group: polar
		if (hot < 0) {
			classes[r] = CLASS_ID.EF
			continue
		}
		if (hot < 10) {
			classes[r] = CLASS_ID.ET
			continue
		}

		// B group: arid — summerFrac uses local warm-season rain
		let aridityThreshold = 20 * annualTemp
		if (summerFrac >= 0.7) aridityThreshold += 280
		else if (summerFrac <= 0.3) aridityThreshold += 0
		else aridityThreshold += 140
		aridityThreshold = Math.max(0, aridityThreshold)

		if (annualRain < aridityThreshold) {
			const hotArid = annualTemp >= 18
			if (annualRain < aridityThreshold * 0.5) {
				classes[r] = hotArid ? CLASS_ID.BWh : CLASS_ID.BWk
			} else {
				classes[r] = hotArid ? CLASS_ID.BSh : CLASS_ID.BSk
			}
			continue
		}

		// A group: tropical (coldest month >= 18°C)
		if (cold >= 18) {
			if (driestMonth >= 60) classes[r] = CLASS_ID.Af
			else if (annualRain >= 25 * (100 - driestMonth)) classes[r] = CLASS_ID.Am
			else classes[r] = CLASS_ID.Aw
			continue
		}

		// Precipitation pattern: s/w/f (using local summer/winter)
		const drySummer = driestSummer < 40 && driestSummer < wettestWinter / 3
		const dryWinter = driestWinter < wettestSummer / 10
		const precipLetter = drySummer ? "s" : dryWinter ? "w" : "f"

		// Temperature sub-letter: a/b/c/d
		// a: Thot >= 22 (standard Koppen — no monthsAbove10 guard)
		// b: Thot < 22 but 4+ months >= 10
		// c: fewer than 4 months >= 10, coldest >= -38
		// d: coldest < -38 (extreme continental)
		let tempLetter: "a" | "b" | "c" | "d"
		if (hot >= 22) tempLetter = "a"
		else if (monthsAbove10 >= 4) tempLetter = "b"
		else if (cold >= -38) tempLetter = "c"
		else tempLetter = "d"

		// C group: temperate (coldest month 0–18°C)
		if (cold >= 0) {
			const code = `C${precipLetter}${tempLetter}`
			classes[r] = CLASS_ID[code] ?? CLASS_ID.Cfb
			continue
		}

		// D group: continental (coldest month < 0°C)
		const code = `D${precipLetter}${tempLetter}`
		classes[r] = CLASS_ID[code] ?? CLASS_ID.Dfc
	}
}

function koppenClimateColor(classId: number): [number, number, number] {
	return KOPPEN_CLASSES[classId]?.color ?? KOPPEN_CLASSES[0].color
}

function koppenClimateName(classId: number): string {
	return KOPPEN_CLASSES[classId]?.name ?? KOPPEN_CLASSES[0].name
}

export const KOPPEN = {
	koppenLabels,
	koppenCells,
	koppenClimateColor,
	koppenClimateName,
}
