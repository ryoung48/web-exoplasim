import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"

const baseUrl = process.env.GCM_TEST_URL ?? "http://localhost:5174"
const output = path.resolve("stats/exoplasim-model-options")
const truncations = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [21, 42]
assert(truncations.every((value) => value === 21 || value === 42), "Specify only truncations 21 and/or 42")
const layerCounts = process.env.GCM_TEST_LAYERS ? process.env.GCM_TEST_LAYERS.split(",").map(Number) : [10, 5]
assert(layerCounts.every((value) => value === 5 || value === 10))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
const errors = []
page.on("pageerror", (error) => errors.push(error.message))
try {
	await page.goto(`${baseUrl}/gcm`)
	const cores = []
    for (const layers of layerCounts) {
    const core = await page.evaluate(async (layers) => {
		const { GCM } = await import("/src/model/climate/gcm/index.ts")
		const { GCM_FIELDS } = await import("/src/model/climate/gcm/fields/index.ts")
		const { GCM_GRID } = await import("/src/model/climate/gcm/grid/index.ts")
		const { GCM_NAMELIST } = await import("/src/model/climate/gcm/namelist/index.ts")
		const { GCM_BOUNDARY } = await import("/src/model/climate/gcm/boundary/index.ts")
		const { GCM_AVERAGES } = await import("/src/model/climate/gcm/averages/index.ts")
		const { GCM_CHECKPOINT } = await import("/src/model/climate/gcm/checkpoint/index.ts")
		const { GCM_DISPLAY } = await import("/src/ui/gcm/field-display.ts")
		const check = ({ condition, message }) => { if (!condition) throw new Error(message) }
		const config = { ...GCM.DEFAULT_CONFIG, layers, atmosphere: { ...GCM.DEFAULT_CONFIG.atmosphere, partialPressures: { ...GCM.DEFAULT_CONFIG.atmosphere.partialPressures, N2: 0.78, O2: 0.21, Ar: 0.01, CO2: 1 / 999 } }, gravityMs2: 12, radiusEarth: 1.2, synchronous: true, substellarLongitudeDeg: 90, oceanDepthM: 20 }
		const defaults = GCM_NAMELIST.edits(GCM.DEFAULT_CONFIG)
        check({ condition: GCM.DEFAULT_CONFIG.layers === 10 && GCM.DEFAULT_CONFIG.keplerian === false && GCM.DEFAULT_CONFIG.periapseLongitudeDeg === null && GCM.DEFAULT_CONFIG.initialMeanAnomalyDeg === null, message: "Orbital/layer defaults differ from upstream" })
        check({ condition: defaults.planet_namelist.NGENKEPLERIAN === "0" && !("MVELP" in defaults.planet_namelist) && !("MEANANOM0" in defaults.planet_namelist), message: "Default orbital overrides were written" })
        const orbit = GCM_NAMELIST.edits({ ...config, keplerian: true, periapseLongitudeDeg: 45, initialMeanAnomalyDeg: 0 }).planet_namelist
        check({ condition: orbit.NGENKEPLERIAN === "1" && orbit.MVELP === "45" && orbit.MEANANOM0 === "0", message: "Orbital controls not mapped to the native namelist" })
        for (const patch of [{ layers: 7 }, { periapseLongitudeDeg: -1 }, { periapseLongitudeDeg: 361 }, { initialMeanAnomalyDeg: NaN }, { initialMeanAnomalyDeg: Infinity }]) {
            let rejected = false
            try { GCM_NAMELIST.edits({ ...config, ...patch }) } catch { rejected = true }
            check({ condition: rejected, message: "Invalid orbit/layer setting accepted" })
        }
        check({ condition: [GCM.DEFAULT_CONFIG.landAlbedo, GCM.DEFAULT_CONFIG.oceanAlbedo, GCM.DEFAULT_CONFIG.snowIceAlbedo].every((value) => value === null), message: "Albedo defaults must remain native" })
        check({ condition: !defaults.seamod_namelist && !Object.keys(defaults.landmod_namelist).some((key) => !["NWETSOIL", "DSOILZ"].includes(key)), message: "Default albedo namelists changed" })
        check({ condition: GCM.DEFAULT_CONFIG.soilWaterCapacityM === null && GCM.DEFAULT_CONFIG.soilHeatCapacity === null && GCM.DEFAULT_CONFIG.soilDepthScale === 1, message: "Soil controls do not preserve upstream defaults" })
        check({ condition: defaults.landmod_namelist.DSOILZ === "0.4,0.8,1.6,3.2,6.4" && !("WSMAX" in defaults.landmod_namelist) && !("SOILCAP" in defaults.landmod_namelist), message: "Native soil namelists changed" })
        const soilEdits = GCM_NAMELIST.edits({ ...config, soilWaterCapacityM: 0.25, soilHeatCapacity: 3000000, soilDepthScale: 2 }).landmod_namelist
        check({ condition: soilEdits.WSMAX === "0.25" && soilEdits.SOILCAP === "3000000" && soilEdits.DSOILZ === "0.8,1.6,3.2,6.4,12.8", message: "Soil override mapping differs from upstream" })
        for (const key of ["soilWaterCapacityM", "soilHeatCapacity", "soilDepthScale"]) for (const value of [0, -1, NaN, Infinity]) {
            let rejected = false
            try { GCM_NAMELIST.edits({ ...config, [key]: value }) } catch { rejected = true }
            check({ condition: rejected, message: `Invalid soil parameter accepted: ${key}` })
        }
        const overrides = GCM_NAMELIST.edits({ ...config, landAlbedo: 0, oceanAlbedo: 0.07, snowIceAlbedo: 0.65 })
        check({ condition: JSON.stringify(overrides.landmod_namelist) === JSON.stringify({ NWETSOIL: "0", DSOILZ: "0.4,0.8,1.6,3.2,6.4", ALBLAND: "0", DGROUNDALB: "0,0", DSNOWALBMN: "0.65,0.65", DGLACALBMN: "0.65,0.65", DSNOWALB: "0.65,0.65" }), message: "Land/snow overrides differ from upstream" })
        check({ condition: JSON.stringify(overrides.seamod_namelist) === JSON.stringify({ ALBSEA: "0.07", DOCEANALB: "0.07,0.07", ALBICE: "0.65", DICEALBMN: "0.65,0.65", DICEALBMX: "0.65,0.65" }), message: "Ocean/ice overrides differ from upstream" })
        for (const value of [-0.01, 1.01, NaN, Infinity]) {
            let rejected = false
            try { GCM_NAMELIST.edits({ ...config, landAlbedo: value }) } catch { rejected = true }
            check({ condition: rejected, message: "Invalid albedo accepted" })
        }
        const edits = GCM_NAMELIST.edits(config)
        check({ condition: layers === 5 ? edits.plasim_namelist.NSELA === "0" : !("NSELA" in edits.plasim_namelist), message: "Layer-specific native transport configuration is incorrect" })
		check({ condition: Math.abs(+edits.radmod_namelist.CO2 - 1000) < 1e-9 && edits.radmod_namelist.NFIXED === "1", message: "CO₂ or synchronous illumination missing" })
		check({ condition: edits.planet_namelist.GA === "12" && +edits.planet_namelist.PLARAD === 6371220 * 1.2, message: "Planet dimensions incorrect" })
		check({ condition: edits.plasim_namelist.FIXEDLON === "90" && edits.oceanmod_namelist.MLDEPTH === "20", message: "Substellar longitude or ocean depth incorrect" })
		check({ condition: Math.abs(+edits.plasim_namelist.PSURF - 1e5 / 0.999) < 1e-8, message: "CO₂ excluded from total pressure" })
		const mmw = (0.78 * 28.0134 + 0.21 * 31.9988 + 0.01 * 39.948) * 0.999 + 44.01 * 0.001
		check({ condition: Math.abs(+edits.planet_namelist.GASCON - 8314.46261815324 / mmw) < 1e-10, message: "CO₂ excluded from molecular weight" })
		check({ condition: GCM_NAMELIST.edits(GCM.DEFAULT_CONFIG).radmod_namelist.NFIXED === "0", message: "Unintended synchronous illumination" })
        const fakeFactory = URL.createObjectURL(new Blob([`export default async (options) => {
            const files = new Map([["/N0174.sra", "land"], ["/N0199.sra", "other"], ["/N0229.sra", "soil water"], ["/landmod_namelist", "&LANDMOD\\n /END"]]);
            return { FS: { readdir: () => [...files.keys()].map(path => path.slice(1)), unlink: path => files.delete(path), readFile: path => files.get(path), writeFile: (path, value) => files.set(path, value), analyzePath: () => ({ exists: false }) }, callMain: () => options.print(JSON.stringify([...files.keys()])) };
        }`], { type: "text/javascript" }))
        try {
            for (const scenario of [{ keep: true, override: false, soil: false }, { keep: true, override: true, soil: false }, { keep: true, override: false, soil: true }, { keep: true, override: true, soil: true }, { keep: false, override: false, soil: false }]) {
                const worker = new Worker("/src/model/climate/gcm/runner/gcm.worker.ts", { type: "module" })
                try {
                    const paths = await new Promise((resolve, reject) => {
                        const timer = setTimeout(() => reject(new Error("Surface file preparation timed out")), 10000)
                        worker.onerror = error => { clearTimeout(timer); reject(new Error(error.message)) }
                        worker.onmessage = ({ data }) => {
                            if (data.type === "loaded") worker.postMessage({ type: "run" })
                            if (data.type === "error") { clearTimeout(timer); reject(new Error(data.message)) }
                            if (data.type === "exit") { clearTimeout(timer); resolve(JSON.parse(data.log[0])) }
                        }
                        worker.postMessage({ type: "load", layers, rank: 0, size: 1, exchange: new SharedArrayBuffer(64), control: new SharedArrayBuffer(16), moduleUrl: fakeFactory, dataUrl: "", files: {}, keepSurfaceFiles: scenario.keep, restart: null, namelistEdits: { landmod_namelist: { ...(scenario.override ? { ALBLAND: "0" } : {}), ...(scenario.soil ? { WSMAX: "0.25" } : {}) } }, publishEvery: 4, spin: 0 })
                    })
                    check({ condition: paths.includes("/N0174.sra") === (scenario.keep && !scenario.override), message: "Land albedo map removal differs from upstream" })
                    check({ condition: paths.includes("/N0229.sra") === (scenario.keep && !scenario.soil), message: "Soil-water map removal differs from upstream" })
                    check({ condition: paths.includes("/N0199.sra") === scenario.keep, message: "Unrelated surface map removed" })
                } finally { worker.terminate() }
            }
        } finally { URL.revokeObjectURL(fakeFactory) }
		const terrain = { name: "Flat land", width: 4, height: 2, elevationM: new Float32Array(8).fill(1000), land: new Float32Array(8).fill(1) }
		for (const latitudes of [32, 64]) {
			const grid = GCM_GRID.forLatitudes(latitudes)
			const boundary = GCM_BOUNDARY.fromTerrain({ grid, terrain, gravityMs2: 12 })
			check({ condition: boundary.geopotential.every((value) => Math.abs(value - 12000) < 1e-8), message: "Terrain ignores configured gravity" })
			const snapshot = { layers, step: 4, date: { year: 1, month: 1, day: 1, hour: 0, minute: 0 }, values: new Float32Array(grid.points * GCM_FIELDS.fieldCount(layers)) }
			const fill = ({ field, value }) => GCM_FIELDS.field({ snapshot, field }).fill(value)
			fill({ field: "surfaceTemperature", value: 280 })
			fill({ field: "airTemperature", value: 285 })
            fill({ field: "seaLevelPressure", value: 101325 })
			fill({ field: "evaporation", value: 1 / 86400000 })
			fill({ field: "runoff", value: 2 / 86400000 })
            fill({ field: "snowfall", value: 3 / 86400000 })
            fill({ field: "snowmelt", value: 4 / 86400000 })
            fill({ field: "seaIceThickness", value: 2 })
            fill({ field: "glacierCover", value: 0.25 })
			fill({ field: "forestCover", value: 0.75 })
			fill({ field: "leafAreaIndex", value: 3 })
			fill({ field: "toaNetRadiation", value: -20 })
			fill({ field: "surfaceNetHeat", value: 10 })
            fill({ field: "convectivePrecipitation", value: 2 / 86400000 })
            fill({ field: "largeScalePrecipitation", value: 3 / 86400000 })
            fill({ field: "toaShortwave", value: 700 })
            fill({ field: "toaLongwave", value: -250 })
            for (const [field, value] of [["surfaceShortwave", 200], ["surfaceLongwave", -60], ["sensibleHeatFlux", -20], ["latentHeatFlux", -100]]) {
                fill({ field, value })
                check({ condition: GCM_FIELDS.values({ snapshot, mode: field })[0] === value, message: `Surface energy sign/units changed: ${field}` })
            }
			for (const level of GCM_FIELDS.levels(layers)) {
				fill({ field: `layerTemperature${level}`, value: 200 + level * 5 })
				fill({ field: `layerWindU${level}`, value: 3 })
				fill({ field: `layerWindV${level}`, value: 4 })
				fill({ field: `layerHumidity${level}`, value: level / 10 })
                fill({ field: `layerCloud${level}`, value: level / 20 })
			}
			check({ condition: Math.abs(GCM_FIELDS.values({ snapshot, mode: "evaporation" })[0] - 1) < 1e-6, message: "Evaporation conversion incorrect" })
			check({ condition: Math.abs(GCM_FIELDS.values({ snapshot, mode: "runoff" })[0] - 2) < 1e-6, message: "Runoff conversion incorrect" })
			check({ condition: GCM_FIELDS.values({ snapshot, mode: "forestCover" })[0] === 75, message: "Forest fraction conversion incorrect" })
			check({ condition: GCM_FIELDS.values({ snapshot, mode: "relativeHumidity" })[0] === layers * 10, message: "Lowest-layer humidity points at wrong layer" })
			check({ condition: GCM_FIELDS.values({ snapshot, mode: "layerWind1" })[0] === 5, message: "Layer wind vector incorrect" })
			check({ condition: Math.abs(GCM_FIELDS.values({ snapshot, mode: `layerTemperature${layers}` })[0] - (200 + layers * 5 - 273.15)) < 1e-4, message: "Layer temperature offset incorrect" })
			for (const { mode } of GCM_FIELDS.MODES.filter(({ mode }) => !GCM_FIELDS.layer(mode) || GCM_FIELDS.layer(mode).level <= layers)) {
				const values = GCM_FIELDS.values({ snapshot, mode })
				check({ condition: values.length === grid.points && values.every(Number.isFinite), message: `Invalid map ${mode}` })
				check({ condition: GCM_DISPLAY.color({ mode, value: values[0] }).every(Number.isFinite), message: `Missing palette for ${mode}` })
				for (const unitSystem of ["metric", "imperial"]) check({ condition: !GCM_DISPLAY.format({ mode, value: values[0], unitSystem }).includes("NaN"), message: `Invalid units for ${mode}` })
			}
			check({ condition: Math.abs(GCM_FIELDS.values({ snapshot, mode: "snowfall" })[0] - 3) < 1e-6, message: "Snowfall water-equivalent conversion incorrect" })
            check({ condition: Math.abs(GCM_FIELDS.values({ snapshot, mode: "snowmelt" })[0] - 4) < 1e-6, message: "Snowmelt water-equivalent conversion incorrect" })
            check({ condition: GCM_FIELDS.values({ snapshot, mode: "seaIceThickness" })[0] === 2000, message: "Ice thickness incorrectly converted" })
            check({ condition: GCM_FIELDS.values({ snapshot, mode: "glacierCover" })[0] === 25, message: "Glacier cover incorrectly converted" })
            check({ condition: GCM_DISPLAY.format({ mode: "seaIceThickness", value: 2000, unitSystem: "imperial" }).includes("78.7"), message: "Physical ice thickness not converted to inches" })
            check({ condition: Math.abs(GCM_FIELDS.values({ snapshot, mode: "seaLevelPressure" })[0] - 1013.25) < 0.001, message: "Sea-level pressure not converted from Pa" })
            check({ condition: Math.abs(GCM_FIELDS.values({ snapshot, mode: "layerCloud5" })[0] - 25) < 0.001, message: "Cloud layer fraction incorrectly selected or converted" })
            const averager = GCM_AVERAGES.create()
			for (let month = 1; month <= 12; month++) GCM_AVERAGES.add({ averager, snapshot: { ...snapshot, date: { ...snapshot.date, month } } })
			GCM_AVERAGES.add({ averager, snapshot: { ...snapshot, date: { ...snapshot.date, year: 2 } } })
			const annual = GCM_AVERAGES.annual(averager)
			check({ condition: annual && Math.abs(GCM_FIELDS.values({ snapshot: annual, mode: "layerHumidity5" })[0] - 50) < 1e-4, message: "Layer averages lost" })
			for (const [mode, expected] of [["convectivePrecipitation", 2], ["largeScalePrecipitation", 3], ["toaShortwave", 700], ["toaLongwave", -250], ["surfaceShortwave", 200], ["surfaceLongwave", -60], ["sensibleHeatFlux", -20], ["latentHeatFlux", -100], ["snowfall", 3], ["snowmelt", 4], ["seaIceThickness", 2000], ["glacierCover", 25], ["seaLevelPressure", 1013.25], ["layerCloud5", 25]]) {
                check({ condition: Math.abs(GCM_FIELDS.values({ snapshot: annual, mode })[0] - expected) < 0.001, message: `Annual ${mode} lost or mis-scaled` })
            }
            const checkpoint = GCM_CHECKPOINT.encode({ terrain, meta: { format: GCM_CHECKPOINT.FORMAT, config: { ...config, truncation: latitudes === 32 ? 21 : 42 }, precisionBytes: 8, date: snapshot.date, step: snapshot.step }, diagnostics: { snapshot, averager }, restart: new Uint8Array([1, 2, 3]).buffer })
			const restored = GCM_CHECKPOINT.decode(checkpoint)
			const mismatched = GCM_CHECKPOINT.encode({ ...restored, meta: { ...restored.meta, config: { ...restored.meta.config, layers: layers === 5 ? 10 : 5 } } })
            let rejectedMismatch = false
            try { GCM_CHECKPOINT.decode(mismatched) } catch { rejectedMismatch = true }
            check({ condition: rejectedMismatch, message: "Mismatched layer checkpoint accepted" })
            const older = GCM_CHECKPOINT.encode({ ...restored, meta: { ...restored.meta, format: GCM_CHECKPOINT.FORMAT - 1 } })
			let rejectedOlder = false
			try { GCM_CHECKPOINT.decode(older) } catch (error) { rejectedOlder = error.message.includes("Unsupported checkpoint format") }
			check({ condition: rejectedOlder, message: "An obsolete snapshot layout was accepted" })
			check({ condition: Math.abs(+GCM_NAMELIST.edits(restored.meta.config).radmod_namelist.CO2 - 1000) < 1e-9 && restored.meta.config.oceanDepthM === 20 && restored.meta.config.synchronous, message: "New controls lost in checkpoint" })
			check({ condition: restored.diagnostics.snapshot.values.every((value, i) => value === snapshot.values[i]), message: "Expanded snapshot changed in checkpoint" })
			check({ condition: GCM_AVERAGES.annual(restored.diagnostics.averager).values.length === snapshot.values.length, message: "Annual checkpoint history lost" })
		}
		return { fields: GCM_FIELDS.fieldCount(layers), mapModes: GCM_FIELDS.MODES.filter(({ mode }) => !GCM_FIELDS.layer(mode) || GCM_FIELDS.layer(mode).level <= layers).length, layers, checkpointFormat: GCM_CHECKPOINT.FORMAT }
	}, layers)
    cores.push(core)
    }
	console.log("Core checks:", cores)
	const simulations = []
	for (const truncation of truncations) {
        for (const layers of layerCounts) {
		for (const ranks of [2, 4, 8]) {
			const result = await page.evaluate(async ({ truncation, ranks, layers }) => {
				const { GCM } = await import("/src/model/climate/gcm/index.ts")
				const { GCM_FIELDS } = await import("/src/model/climate/gcm/fields/index.ts")
				const { GCM_RUNNER } = await import("/src/model/climate/gcm/runner/index.ts")
				const { GCM_AVERAGES } = await import("/src/model/climate/gcm/averages/index.ts")
				const { GCM_CHECKPOINT } = await import("/src/model/climate/gcm/checkpoint/index.ts")
				const check = ({ condition, message }) => { if (!condition) throw new Error(message) }
				const config = { ...GCM.DEFAULT_CONFIG, truncation, layers, keplerian: ranks === 8, periapseLongitudeDeg: ranks === 8 ? 45 : null, initialMeanAnomalyDeg: ranks === 8 ? 90 : null, timestepMinutes: 30, atmosphere: { ...GCM.DEFAULT_CONFIG.atmosphere, partialPressures: { ...GCM.DEFAULT_CONFIG.atmosphere.partialPressures, N2: 0.78, O2: 0.21, Ar: 0.01, CO2: 1 / 999 } }, gravityMs2: 12, radiusEarth: 1.2, synchronous: ranks !== 8, substellarLongitudeDeg: 90, oceanDepthM: 20, vegetation: ranks === 2 ? 0 : ranks === 4 ? 1 : 2, ...(ranks === 8 ? { landAlbedo: 0.31, oceanAlbedo: 0.07, snowIceAlbedo: 0.65, soilWaterCapacityM: 0.25, soilHeatCapacity: 3000000, soilDepthScale: 2 } : {}) }
				const terrain = { name: "Test continent", width: 4, height: 2, elevationM: new Float32Array([1000, 1000, 0, 0, 1000, 1000, 0, 0]), land: new Float32Array([1, 1, 0, 0, 1, 1, 0, 0]) }
				const manifest = await GCM_RUNNER.manifest()
				const resolution = manifest.resolutions.find((entry) => entry.truncation === truncation && entry.layers === layers)
				const averager = GCM_AVERAGES.create()
				let latest = null
				let firstStep = null
				let completedRangeDays = 0
				let run = null
				let saved = null
				const started = performance.now()
				try {
					await new Promise((resolve, reject) => {
						const timeout = setTimeout(() => { run?.stop(); reject(new Error("Simulation timed out")) }, 120000)
						const fail = (error) => { clearTimeout(timeout); run?.stop(); reject(error) }
						run = GCM_RUNNER.start({ config, terrain, resolution, ranks, publishEvery: 4, restart: null, startPaused: false,
							onSnapshot(snapshot) {
								try {
									check({ condition: snapshot.values.length === resolution.latitudes ** 2 * 2 * GCM_FIELDS.fieldCount(layers), message: "Snapshot size mismatch" })
									check({ condition: snapshot.values.every(Number.isFinite), message: "Nonfinite model diagnostic" })
 const minimum = GCM_FIELDS.field({ snapshot, field: "airTemperatureMin" })
 const maximum = GCM_FIELDS.field({ snapshot, field: "airTemperatureMax" })
 const air = GCM_FIELDS.field({ snapshot, field: "airTemperature" })
 check({ condition: air.every((value, index) => minimum[index] <= value && value <= maximum[index]), message: "Actual air-temperature extrema do not bracket the published temperature" })
 const rangeDays = GCM_FIELDS.field({ snapshot, field: "dailyTemperatureRangeDays" })
 const rangeSum = GCM_FIELDS.field({ snapshot, field: "dailyTemperatureRangeSum" })
 const dailyRange = GCM_FIELDS.values({ snapshot, mode: "diurnalTemperatureRange" })
 check({ condition: rangeDays.every(value => Number.isInteger(value) && value >= 0 && value === rangeDays[0]) && rangeSum.every(value => value >= 0) && dailyRange.every(value => value >= 0), message: "Invalid daily temperature range diagnostics" })
 completedRangeDays += rangeDays[0]
									latest = snapshot
									firstStep ??= snapshot.step - 4
									GCM_AVERAGES.add({ averager, snapshot })
									if (snapshot.step - firstStep >= 48) run.checkpoint()
								} catch (error) { fail(error) }
							},
							onStatus({ status, message }) { if (status === "failed") fail(new Error(message)) },
							onCheckpoint(restart) { clearTimeout(timeout); saved = GCM_CHECKPOINT.encode({ terrain, meta: { format: GCM_CHECKPOINT.FORMAT, config, precisionBytes: resolution.precisionBytes, date: latest.date, step: latest.step }, diagnostics: { snapshot: latest, averager }, restart }); resolve() },
						})
					})
					const elapsedMs = performance.now() - started
					const restored = GCM_CHECKPOINT.decode(saved)
					check({ condition: completedRangeDays >= 1, message: "No completed daily ranges were captured" })
					check({ condition: restored.meta.config.landAlbedo === config.landAlbedo && restored.meta.config.oceanAlbedo === config.oceanAlbedo && restored.meta.config.snowIceAlbedo === config.snowIceAlbedo, message: "Albedo settings lost in checkpoint" })
                    check({ condition: restored.meta.config.soilWaterCapacityM === config.soilWaterCapacityM && restored.meta.config.soilHeatCapacity === config.soilHeatCapacity && restored.meta.config.soilDepthScale === config.soilDepthScale, message: "Soil settings lost in checkpoint" })
                    for (const [total, left, right] of [["precipitation", "convectivePrecipitation", "largeScalePrecipitation"], ["toaNetRadiation", "toaShortwave", "toaLongwave"]]) {
                        const totalValues = GCM_FIELDS.values({ snapshot: latest, mode: total })
                        const leftValues = GCM_FIELDS.values({ snapshot: latest, mode: left })
                        const rightValues = GCM_FIELDS.values({ snapshot: latest, mode: right })
                        check({ condition: totalValues.every((value, index) => Math.abs(value - leftValues[index] - rightValues[index]) < 0.001), message: `Native component sum incorrect: ${total}` })
                    }
                    check({ condition: restored.meta.config.layers === layers && restored.meta.config.keplerian === config.keplerian && restored.meta.config.periapseLongitudeDeg === config.periapseLongitudeDeg && restored.meta.config.initialMeanAnomalyDeg === config.initialMeanAnomalyDeg && restored.diagnostics.snapshot.layers === layers, message: "Orbit/layers lost in checkpoint" })
                    const maps = Object.fromEntries(["convectivePrecipitation", "largeScalePrecipitation", "toaShortwave", "toaLongwave", "surfaceShortwave", "surfaceLongwave", "sensibleHeatFlux", "latentHeatFlux", "seaLevelPressure", "layerCloud1", `layerCloud${layers}`, "snowfall", "snowmelt", "seaIceThickness", "glacierCover", "evaporation", "runoff", "forestCover", "leafAreaIndex", "relativeHumidity", "toaNetRadiation", "surfaceNetHeat", "layerTemperature1", `layerTemperature${layers}`, "layerWind5"].map((mode) => {
						const values = GCM_FIELDS.values({ snapshot: latest, mode })
						return [mode, { min: Math.min(...values), max: Math.max(...values) }]
					}))
					if (config.vegetation === 0) check({ condition: maps.leafAreaIndex.max === 0, message: "Disabled vegetation has leaf area" })
					let resumedSnapshots = 0
					await new Promise((resolve, reject) => {
						const timeout = setTimeout(() => { run?.stop(); reject(new Error("Paused restart timed out")) }, 120000)
						run = GCM_RUNNER.start({ config: restored.meta.config, terrain: restored.terrain, resolution, ranks, publishEvery: 4, restart: restored.restart, startPaused: true,
							onSnapshot() { resumedSnapshots++ },
							onCheckpoint() {},
							onStatus({ status, message }) {
								if (status === "failed") { clearTimeout(timeout); run?.stop(); reject(new Error(message)) }
								if (status === "paused") setTimeout(() => { clearTimeout(timeout); resolve() }, 250)
							},
						})
					})
					check({ condition: resumedSnapshots === 0, message: "Paused checkpoint advanced the simulation" })
					return { truncation, ranks, layers, vegetation: config.vegetation, steps: latest.step - firstStep, elapsedMs, checkpointBytes: saved.byteLength, maps }
				} finally { run?.stop() }
			}, { truncation, ranks, layers })
			simulations.push(result)
			console.log(`T${truncation}/${layers} layers/${ranks} ranks: ${result.steps} steps, ${(result.elapsedMs / 1000).toFixed(2)} s; paused restart passed`)
		}
	}
    }
    await page.getByRole("checkbox", { name: "Generic Keplerian orbit", exact: true }).waitFor()
    assert.equal(await page.getByRole("checkbox", { name: "Generic Keplerian orbit", exact: true }).isChecked(), false)
    assert.equal(await page.getByRole("checkbox", { name: "Longitude of periapse override", exact: true }).isChecked(), false)
    assert.equal(await page.getByRole("checkbox", { name: "Initial orbital phase override", exact: true }).count(), 0)
    await page.getByRole("checkbox", { name: "Generic Keplerian orbit", exact: true }).check()
    await page.getByRole("checkbox", { name: "Longitude of periapse override", exact: true }).check()
    await page.getByRole("slider", { name: "Longitude of periapse", exact: true }).fill("45")
    await page.getByRole("checkbox", { name: "Initial orbital phase override", exact: true }).check()
    await page.getByRole("slider", { name: "Initial orbital phase", exact: true }).fill("90")
    await page.getByRole("checkbox", { name: "Generic Keplerian orbit", exact: true }).uncheck()
    assert.equal(await page.getByRole("slider", { name: "Initial orbital phase", exact: true }).count(), 0)
    await page.getByRole("checkbox", { name: "Generic Keplerian orbit", exact: true }).check()
    assert.equal(await page.getByRole("slider", { name: "Initial orbital phase", exact: true }).inputValue(), "90")
    await page.getByRole("button", { name: "5 layers", exact: true }).click()
    await page.getByRole("button", { name: "Temperature", exact: true }).click()
    await page.getByRole("button", { name: "Atmosphere", exact: true }).click()
    await page.getByRole("button", { name: "5 · bottom", exact: true }).waitFor()
    assert.equal(await page.getByRole("button", { name: "10 · bottom", exact: true }).count(), 0)
    await page.getByRole("button", { name: "10 layers", exact: true }).click()
    await page.getByRole("button", { name: "10 · bottom", exact: true }).waitFor()
    await page.getByRole("button", { name: `${layerCounts[layerCounts.length - 1]} layers`, exact: true }).click()
    await page.getByRole("checkbox", { name: "Tidally locked illumination", exact: true }).check()
	await page.getByRole("slider", { name: "Substellar longitude", exact: true }).waitFor()
	await page.getByRole("checkbox", { name: "Tidally locked illumination", exact: true }).uncheck()
	assert.equal(await page.getByRole("slider", { name: "Substellar longitude", exact: true }).count(), 0)
	for (const [label, value] of [["Planet radius", "1"], ["Ocean mixed-layer depth", "50"]]) assert.equal(await page.getByRole("slider", { name: label, exact: true }).inputValue(), value)
	assert.equal(await page.getByRole("slider", { name: "Soil depth multiplier", exact: true }).inputValue(), "1")
    for (const [label, value] of [["Soil water capacity", "0.25"], ["Soil heat capacity", "3000000"]]) {
        const toggle = page.getByRole("checkbox", { name: `${label} override`, exact: true })
        assert.equal(await toggle.isChecked(), false)
        assert.equal(await page.getByRole("slider", { name: label, exact: true }).count(), 0)
        await toggle.check()
        await page.getByRole("slider", { name: label, exact: true }).fill(value)
        await toggle.uncheck()
    }
    await page.getByRole("checkbox", { name: "Soil water capacity override", exact: true }).check()
    await page.getByRole("slider", { name: "Soil water capacity", exact: true }).fill("0.25")
    await page.getByRole("checkbox", { name: "Soil heat capacity override", exact: true }).check()
    await page.getByRole("slider", { name: "Soil heat capacity", exact: true }).fill("3000000")
    await page.getByRole("slider", { name: "Soil depth multiplier", exact: true }).fill("2")
    for (const label of ["Land albedo", "Ocean albedo", "Snow/ice albedo"]) {
        const toggle = page.getByRole("checkbox", { name: `${label} override`, exact: true })
        assert.equal(await toggle.isChecked(), false)
        assert.equal(await page.getByRole("slider", { name: label, exact: true }).count(), 0)
        await toggle.check()
        const slider = page.getByRole("slider", { name: label, exact: true })
        await slider.fill("0")
        assert.equal(await slider.inputValue(), "0")
        await toggle.uncheck()
    }
    await page.getByRole("checkbox", { name: "Land albedo override", exact: true }).check()
    await page.getByRole("slider", { name: "Land albedo", exact: true }).fill("0.31")
    await page.getByRole("button", { name: "About Initial orbital phase override", exact: true }).focus()
    await page.getByRole("tooltip").waitFor()
    await page.screenshot({ path: path.join(output, "orbit-help.png"), animations: "disabled" })
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "Start", exact: true }).click()
	await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => button.textContent === "Pause") && !document.body.textContent.includes("No data yet"), null, { timeout: 120000 })
	await page.getByRole("button", { name: "Pause", exact: true }).click()
	for (const [group, children] of [
		["Water cycle", ["Convective", "Large-scale", "Evaporation", "Runoff"]],
        ["Ice & snow", ["Snowfall", "Snowmelt", "Ice thickness", "Glaciers"]],
		["Moisture", ["Relative humidity", "Atmosphere"]],
		["Vegetation", ["Forest cover", "Leaf area"]],
		["Radiation", ["TOA net", "TOA solar", "TOA thermal"]],
        ["Surface energy", ["Net heat", "Solar", "Thermal", "Sensible", "Latent"]],
		["Wind", ["Atmosphere"]],
        ["Pressure", ["Surface", "Sea level"]],
        ["Clouds", ["Total cover", "Atmosphere"]],
	]) {
		await page.getByRole("button", { name: group, exact: true }).click()
		for (const child of children) await page.getByRole("button", { name: child, exact: true }).click()
	}
	await page.getByRole("button", { name: "Temperature", exact: true }).click()
	await page.getByRole("button", { name: "Atmosphere", exact: true }).click()
	await page.getByRole("button", { name: "1 · top", exact: true }).click()
	await page.getByRole("button", { name: "Downscaled", exact: true }).click()
	await page.screenshot({ path: path.join(output, "layers.png"), animations: "disabled" })
	const downloadEvent = page.waitForEvent("download")
	await page.getByRole("button", { name: "Save", exact: true }).click()
	const download = await downloadEvent
	const checkpointPath = path.join(output, download.suggestedFilename())
	await download.saveAs(checkpointPath)
	await page.getByRole("button", { name: "Resume", exact: true }).waitFor()
	await page.getByRole("button", { name: "Clear", exact: true }).click()
	await page.locator('input[type="file"][accept=".ckpt"]').setInputFiles(checkpointPath)
	await page.getByRole("button", { name: "Resume", exact: true }).waitFor({ timeout: 120000 })
	assert.equal(await page.getByRole("slider", { name: "Land albedo", exact: true }).inputValue(), "0.31")
    assert.equal(await page.getByRole("slider", { name: "Soil water capacity", exact: true }).inputValue(), "0.25")
    assert.equal(await page.getByRole("slider", { name: "Soil heat capacity", exact: true }).inputValue(), "3000000")
    assert.equal(await page.getByRole("slider", { name: "Soil depth multiplier", exact: true }).inputValue(), "2")
    assert.equal(await page.getByRole("slider", { name: "Longitude of periapse", exact: true }).inputValue(), "45")
    assert.equal(await page.getByRole("slider", { name: "Initial orbital phase", exact: true }).inputValue(), "90")
    await page.getByRole("button", { name: "Surface energy", exact: true }).click()
    await page.getByRole("button", { name: "Latent", exact: true }).click()
	await page.screenshot({ path: path.join(output, "energy.png"), animations: "disabled" })
    await page.getByRole("button", { name: "Water cycle", exact: true }).click()
    await page.getByRole("button", { name: "Convective", exact: true }).click()
    await page.screenshot({ path: path.join(output, "convective-precipitation.png"), animations: "disabled" })
    await page.getByRole("button", { name: "Radiation", exact: true }).click()
    await page.getByRole("button", { name: "TOA thermal", exact: true }).click()
    await page.screenshot({ path: path.join(output, "toa-thermal.png"), animations: "disabled" })
    await page.getByRole("button", { name: "Ice & snow", exact: true }).click()
    await page.getByRole("button", { name: "Ice thickness", exact: true }).click()
    await page.screenshot({ path: path.join(output, "ice.png"), animations: "disabled" })
	await page.getByRole("button", { name: "Clouds", exact: true }).click()
    await page.getByRole("button", { name: "Atmosphere", exact: true }).click()
    await page.getByRole("main").getByRole("button", { name: layerCounts[layerCounts.length - 1] === 5 ? "5 · bottom" : "5", exact: true }).click()
    await page.screenshot({ path: path.join(output, "cloud-layers.png"), animations: "disabled" })
    await page.getByRole("button", { name: "Pressure", exact: true }).click()
    await page.getByRole("button", { name: "Sea level", exact: true }).click()
    await page.screenshot({ path: path.join(output, "sea-level-pressure.png"), animations: "disabled" })
    await page.getByRole("button", { name: "Clear", exact: true }).click()
	assert.deepEqual(errors, [])
	await writeFile(path.join(output, `report-atmosphere-${truncations.join("-")}-${layerCounts.join("-")}.json`), JSON.stringify({ cores, simulations, errors }, null, 2))
	console.log("Model options, requested variants, all map palettes, averages and checkpoint checks passed")
} finally {
	await browser.close()
}
