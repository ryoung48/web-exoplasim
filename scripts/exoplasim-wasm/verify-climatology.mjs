import assert from "node:assert/strict"
import { createServer } from "vite"

const server = await createServer({ server: { watch: null }, logLevel: "error" })
try {
    const { GCM_AVERAGES: A } = await server.ssrLoadModule("/src/model/climate/gcm/averages/index.ts")
    const { GCM_FIELDS: F } = await server.ssrLoadModule("/src/model/climate/gcm/fields/index.ts")
    const { GCM: G } = await server.ssrLoadModule("/src/model/climate/gcm/index.ts")
    const { KOPPEN: K } = await server.ssrLoadModule("/src/model/climate/classification/koppen/index.ts")
    const { GCM_CHECKPOINT: C } = await server.ssrLoadModule("/src/model/climate/gcm/checkpoint/index.ts")
    const config = G.DEFAULT_CONFIG
    const temperatures = [5, 6, 8, 12, 14, 18, 20, 19, 15, 11, 8, 6]
    const dryRain = [35, 35, 35, 20, 25, 25, 25, 25, 70, 35, 35, 35]
    const snapshot = ({ year, month, dry = false }) => {
        const result = { layers: 10, step: (year * 12 + month) * 100, date: { year, month, day: 1, hour: 0, minute: 0 }, values: new Float32Array(2048 * F.fieldCount(10)) }
        for (const [field, value] of Object.entries({
            airTemperature: 273.15 + temperatures[month - 1], surfaceTemperature: 273.15 + year,
            surfaceTemperatureMin: 270 - year, surfaceTemperatureMax: 300 + year,
            precipitation: (dry ? dryRain[month - 1] : 60) / 30 / 86400000,
            landFraction: 1, surfacePressure: 101325, surfaceShortwave: 150, albedo: 0.2,
            layerHumidity10: 0.5, evaporation: 30 / 30 / 86400000,
        })) F.field({ snapshot: result, field }).fill(value)
        return result
    }
    const history = A.create()
    const mirror = A.create()
    const feed = (input) => {
        if (A.add({ averager: history, snapshot: snapshot(input) }))
            A.merge({ averager: mirror, months: history.months.slice(-12), years: history.years })
    }
    for (let year = 1; year <= 10; year++)
        for (let month = 1; month <= 12; month++) feed({ year, month, dry: year === 10 })
    feed({ year: 11, month: 1 })
    const climate = A.view({ averager: history, config })
    assert.equal(climate.climateYears, 10)
    assert.equal(climate.months.length, 12)
    assert.equal(climate.climateMonths.length, 12)
    const cached = A.view({ averager: history, config })
    assert.equal(cached.climateMonths, climate.climateMonths)
    assert.equal(cached.koppen, climate.koppen)
    assert.equal(cached.pasta, climate.pasta)
    feed({ year: 11, month: 2 })
    const nextMonth = A.view({ averager: history, config })
    assert.equal(nextMonth.months[nextMonth.months.length - 1].month, 1)
    assert.equal(nextMonth.climateMonths, climate.climateMonths)
    assert.equal(nextMonth.koppen, climate.koppen)
    assert.equal(nextMonth.pasta, climate.pasta)
    const changedConfig = A.view({ averager: history, config: { ...config, yearDays: 720 } })
    assert.equal(changedConfig.climateMonths, climate.climateMonths)
    assert.notEqual(changedConfig.koppen, climate.koppen)
    assert.equal(K.koppenLabels[climate.koppen[0]], "Cfb")
    const oneYear = A.view({ averager: { ...history, months: history.months.filter((month) => month.year === 10) }, config })
    assert.equal(K.koppenLabels[oneYear.koppen[0]], "Csb")
    assert(Math.abs(F.values({ snapshot: climate.climateMonths[3].snapshot, mode: "precipitation" })[0] * 30 - 56) < 0.001)
    assert.equal(climate.years.length, 10)
    assert(Math.abs(climate.years[9].surfaceTemperature - 283.15) < 0.001)
    assert(Math.abs(F.field({ snapshot: climate.annual, field: "surfaceTemperature" })[0] - 283.15) < 0.001)
    assert.equal(F.field({ snapshot: climate.climateMonths[0].snapshot, field: "surfaceTemperatureMin" })[0], 264.5)
    assert.equal(F.field({ snapshot: climate.climateMonths[0].snapshot, field: "surfaceTemperatureMax" })[0], 305.5)
    assert.deepEqual(A.view({ averager: mirror, config }).koppen, climate.koppen)
    A.merge({ averager: mirror, months: history.months.slice(-12), years: history.years })
    assert.equal(mirror.months.length, 121)
    const terrain = { name: "Climatology fixture", width: 4, height: 2, elevationM: new Float32Array(8), land: new Float32Array(8).fill(1) }
    const latest = snapshot({ year: 11, month: 1 })
    const encoded = C.encode({ meta: { format: C.FORMATS.cpu, config, precisionBytes: 8, date: latest.date, step: latest.step }, terrain, diagnostics: { averager: history, snapshot: latest, targeting: null }, restart: new Uint8Array([1]).buffer })
    const restored = C.decode(encoded)
    assert.equal(A.view({ averager: restored.diagnostics.averager, config }).climateYears, 10)
    assert.deepEqual(A.view({ averager: restored.diagnostics.averager, config }).koppen, climate.koppen)
    for (let month = 2; month <= 12; month++) feed({ year: 11, month })
    feed({ year: 12, month: 1, dry: true })
    const rolled = A.view({ averager: history, config })
    assert.equal(rolled.climateYears, 10)
    assert.equal(rolled.climateMonths[0].year, 11)
    assert.notEqual(rolled.climateMonths, climate.climateMonths)
    assert.notEqual(rolled.koppen, climate.koppen)
    for (let month = 2; month <= 12; month++) feed({ year: 12, month, dry: true })
    const partial = A.view({ averager: history, config })
    assert.equal(partial.climateMonths[0].year, 11)
    assert.equal(history.months.length, 132)
    const incomplete = { ...A.create(), months: history.months.filter((month) => month.year === 12) }
    assert.equal(A.view({ averager: incomplete, config }).climateYears, 0)
    assert.equal(A.view({ averager: incomplete, config }).koppen, null)
    console.log("Ten-year monthly averaging, Csb→Cfb noise reduction, rolling years, partial-year exclusion, unchanged annual balance, extrema, worker mirroring and checkpoint round-trip passed.")
} finally { await server.close() }
