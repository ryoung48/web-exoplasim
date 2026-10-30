import assert from "node:assert/strict"
import { createServer } from "vite"

const server = await createServer({ server: { watch: null }, logLevel: "error" })
try {
    const { PASTA: P } = await server.ssrLoadModule("/src/model/climate/classification/pasta/index.ts")
    const { GCM_CLASSIFICATION: C } = await server.ssrLoadModule("/src/model/climate/gcm/classification/index.ts")
    const { GCM_FIELDS: F } = await server.ssrLoadModule("/src/model/climate/gcm/fields/index.ts")
    const { GCM: G } = await server.ssrLoadModule("/src/model/climate/gcm/index.ts")
    const repeated = (value) => Array(12).fill(value)
    const base = { monthDays: 30, pressureHpa: repeated(1013.25), hydrology: null, land: true, downscaled: false, temperature: repeated(25), minimum: repeated(15), maximum: repeated(35), rainfall: repeated(200), light: repeated(250), surfaceTemperature: repeated(25), seaIce: repeated(0), snow: repeated(0) }
    const code = (patch) => P.CLASSES[P.classify({ ...base, ...patch })].code
    assert.equal(code({ minimum: repeated(10) }), "CTf")
    assert.equal(code({ minimum: repeated(10.001) }), "TUr")
    assert.equal(code({ minimum: repeated(-10) }), "CTf")
    assert.equal(code({ minimum: repeated(-10.001) }), "CDb")
    const boreal = { temperature: [-15,-15,-15,-10,0,5,12,12,5,0,-10,-15] }
    assert.equal(code({ ...boreal, minimum: repeated(-40) }), "CEbp")
    assert.equal(code({ ...boreal, minimum: repeated(-40.001) }), "CEcp")
    assert.equal(code({ maximum: repeated(49.999) }), "TUr")
    assert.equal(code({ maximum: repeated(50) }), "HTf")
    assert.equal(code({ maximum: repeated(70) }), "HTf")
    assert.equal(code({ maximum: repeated(70.001) }), "HDb")
    const supply = { minimum: repeated(0), hydrology: { potential: repeated(100), actual: repeated(100) } }
    assert.equal(code({ ...supply, rainfall: repeated(79.999) }), "CMa")
    assert.equal(code({ ...supply, rainfall: repeated(80) }), "CTf")
    const months = [...Array(12).keys()].map((index) => {
        const snapshot = { layers: 10, date: { year: 1, month: index + 1, day: 1, hour: 0, minute: 0 }, step: index, values: new Float32Array(2048 * F.fieldCount(10)) }
        for (const [field, value] of Object.entries({ airTemperature: 298.15, surfaceTemperature: 308.15, surfaceTemperatureMin: 293.15, surfaceTemperatureMax: 318.15, precipitation: 200 / 30 / 86400000, surfaceShortwave: 200, albedo: 0.2, landFraction: 1, surfacePressure: 101325, evaporation: 175 / 30 / 86400000, layerHumidity10: 0.5 })) F.field({ snapshot, field }).fill(value)
        return { year: 1, month: index + 1, snapshot }
    })
    const adjusted = C.classes({ config: G.DEFAULT_CONFIG, months, downscale: null, scheme: "pasta" })
    assert.equal(P.CLASSES[adjusted[0]].code, "CTf")
    assert.equal(F.field({ snapshot: months[0].snapshot, field: "surfaceTemperatureMin" })[0], Math.fround(293.15))
    console.log("ExoPlaSim winter, summer and GrS thresholds, exact boundaries, surface-to-air adjustment and unchanged raw extrema passed.")
} finally { await server.close() }
