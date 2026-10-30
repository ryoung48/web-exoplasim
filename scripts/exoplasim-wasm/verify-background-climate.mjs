import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { createServer } from "vite"
import { chromium } from "playwright"

const server = await createServer({ server: { host: "127.0.0.1", port: 0, watch: null }, logLevel: "error" })
let browser
try {
    await server.listen()
    browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true })
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/gcm`)
    const report = await page.evaluate(async () => {
        const { GCM: G } = await import("/src/model/climate/gcm/index.ts")
        const { GCM_FIELDS: F } = await import("/src/model/climate/gcm/fields/index.ts")
        const { GCM_AVERAGES: A } = await import("/src/model/climate/gcm/averages/index.ts")
        const { GCM_BACKGROUND_AVERAGES: B } = await import("/src/model/climate/gcm/averages/background/index.ts")
        const { GCM_CLASSIFICATION: C } = await import("/src/model/climate/gcm/classification/index.ts")
        const { GCM_DOWNSCALE: D } = await import("/src/model/climate/gcm/downscale/index.ts")
        const { GCM_GRID: GRID } = await import("/src/model/climate/gcm/grid/index.ts")
        const { GCM_PREPARATION: P } = await import("/src/model/climate/gcm/preparation/index.ts")
        const config = G.DEFAULT_CONFIG
        const terrain = { name: "Background climate", width: 4, height: 2, elevationM: new Float32Array(8), land: new Float32Array(8).fill(1) }
        const template = { layers: 10, step: 0, date: { year: 1, month: 1, day: 1, hour: 0, minute: 0 }, values: new Float32Array(2048 * F.fieldCount(10)) }
        for (const [field, value] of Object.entries({ airTemperature: 298.15, surfaceTemperature: 298.15, surfaceTemperatureMin: 291.15, surfaceTemperatureMax: 308.15, precipitation: 200 / 30 / 86400000, landFraction: 1, surfacePressure: 101325, surfaceShortwave: 150, albedo: 0.2, layerHumidity10: 0.5, evaporation: 175 / 30 / 86400000 })) F.field({ snapshot: template, field }).fill(value)
        const month = (index) => ({ year: Math.floor(index / 12) + 1, month: index % 12 + 1, snapshot: { ...template, step: index * 100, date: { ...template.date, year: Math.floor(index / 12) + 1, month: index % 12 + 1 }, values: template.values.slice() } })
        const initial = { ...A.create(), months: [...Array(119).keys()].map(month) }
        const december = month(119)
        const expected = A.view({ averager: { ...initial, months: [...initial.months, december] }, config })
        const downscale = D.create({ grid: GRID.forTruncation(21), terrain, factor: 1, gravityMs2: 9.80665 })
        const largeTerrain = { ...terrain, width: 720, height: 360, elevationM: new Float32Array(720 * 360), land: new Float32Array(720 * 360).fill(1) }
        const large = D.create({ grid: GRID.forTruncation(21), terrain: largeTerrain, factor: 1, gravityMs2: 9.80665 })
        const reference = C.classes({ config, months: expected.climateMonths, downscale: large, scheme: "pasta" })
        const originalView = A.view
        const originalClasses = C.classes
        A.view = () => { throw new Error("Averages recomputed on the main thread") }
        C.classes = () => { throw new Error("Climate classified on the main thread") }
        let analysis = null
        let receive = null
        let reject = null
        const next = () => new Promise((resolve, fail) => { receive = resolve; reject = fail })
        const timeout = setTimeout(() => reject?.(new Error("Background verification timeout")), 120000)
        const gaps = []
        let ticks = 0
        let previous = performance.now()
        const heartbeat = setInterval(() => { const now = performance.now(); gaps.push(now - previous); previous = now; ticks++ }, 10)
        try {
            const ready = next()
            analysis = B.create({ averager: initial, config, onUpdate: (value) => receive?.(value), onError: (message) => reject?.(new Error(message)) })
            await ready
            gaps.length = 0
            previous = performance.now()
            const annual = next()
            const started = performance.now()
            const tickStart = ticks
            analysis.update({ months: [december], years: [], config })
            const actual = await annual
            const annualMs = performance.now() - started
            const annualTicks = ticks - tickStart
            if (actual.climateYears !== 10 || actual.months.length !== 12 || !actual.koppen.every((value, index) => value === expected.koppen[index]) || !actual.pasta.every((value, index) => value === expected.pasta[index])) throw new Error("Background climatology differs from synchronous reference")
            const monthly = next()
            analysis.update({ months: [month(120)], years: [], config: { ...config } })
            const unchanged = await monthly
            if (unchanged.climateMonths !== actual.climateMonths || unchanged.pasta !== actual.pasta || unchanged.koppen !== actual.koppen) throw new Error("Monthly update replaced cached climate results")
            const fineStarted = performance.now()
            const fineTicks = ticks
            const fine = await P.run({ kind: "classification", input: { config, months: actual.climateMonths, downscale: large, scheme: "pasta" }, signal: new AbortController().signal })
            if (!fine.every((value, index) => value === reference[index])) throw new Error("Background downscaled classification differs")
            const downscaleMs = performance.now() - fineStarted
            const downscaleTicks = ticks - fineTicks
            if (annualTicks === 0 || downscaleTicks === 0) throw new Error("Main-thread heartbeat did not advance during climate calculations")
            if (!december.snapshot.values.byteLength || !actual.climateMonths[0].snapshot.values.byteLength) throw new Error("Live source arrays were detached")
            const controller = new AbortController()
            const cancelled = P.run({ kind: "classification", input: { config, months: actual.climateMonths, downscale, scheme: "koppen" }, signal: controller.signal })
            controller.abort()
            let aborted = false
            try { await cancelled } catch (error) { aborted = error.name === "AbortError" }
            if (!aborted) throw new Error("Obsolete climate work was not cancelled")
            return { annualMs, annualTicks, downscaleMs, downscaleTicks, maximumHeartbeatGapMs: Math.max(...gaps), displayPoints: fine.length, mainThreadClassificationGuard: true, cancellation: true, cachedMonthlyResults: true }
        } finally {
            analysis?.stop()
            clearInterval(heartbeat)
            clearTimeout(timeout)
            A.view = originalView
            C.classes = originalClasses
        }
    })
    assert.equal(report.displayPoints, 720 * 360)
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.evaluate(async () => {
        const { GCM } = await import("/src/model/climate/gcm/index.ts")
        GCM.DEFAULT_CONFIG.yearDays = 12
        const { GCM_AVERAGES } = await import("/src/model/climate/gcm/averages/index.ts")
        const { GCM_CLASSIFICATION } = await import("/src/model/climate/gcm/classification/index.ts")
        GCM_AVERAGES.view = () => { throw new Error("UI called synchronous averaging") }
        GCM_CLASSIFICATION.classes = () => { throw new Error("UI called synchronous classification") }
    })
    await page.getByRole("button", { name: "CPU", exact: true }).click()
    await page.getByRole("button", { name: "8", exact: true }).click()
    await page.getByRole("button", { name: "Start", exact: true }).click()
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => button.textContent === "Climate" && !button.disabled), null, { timeout: 120000 })
    await page.getByRole("button", { name: "Pause", exact: true }).click()
    await page.getByRole("button", { name: "Climate", exact: true }).click()
    await page.getByText(/Köppen · \d+-year monthly climatology/).waitFor()
    await page.getByRole("button", { name: "Downscaled", exact: true }).click()
    await page.getByText("Updating climate map…", { exact: true }).waitFor({ state: "hidden", timeout: 120000 })
    await page.screenshot({ path: "stats/exoplasim-background-climate.png" })
    await page.getByRole("button", { name: "Clear", exact: true }).click()
    assert.deepEqual(errors, [])
    report.liveCpuYearBoundary = true
    report.liveDownscaledMap = true
    await mkdir("stats/exoplasim-background-climate", { recursive: true })
    await writeFile("stats/exoplasim-background-climate/verification.json", JSON.stringify(report, null, 2))
    console.log(report)
} finally { await browser?.close(); await server.close() }
