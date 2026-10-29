import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const referenceColors = process.argv[2] ? Object.fromEntries([...((await readFile(process.argv[2], 'utf8')).match(/const ZONE_COLOR_MAP = ([\s\S]*?) as const/)[1]).matchAll(/(\w+): \[(\d+), (\d+), (\d+)\]/g)].map(match => [match[1], match.slice(2).map(Number)])) : null

const upstream = process.argv[3] ? JSON.parse(await readFile(process.argv[3], 'utf8')) : { petCases: [] }

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
 await page.route('**/src/ui/gcm/live-store.ts*', async route => {
  const response = await route.fetch()
  await route.fulfill({ response, body: await response.text() + '\nconst originalCreate = GCM_LIVE.create; GCM_LIVE.create = () => { const store = originalCreate(); (globalThis.climateTestStores ??= []).push(store); return store };' })
 })
 await page.goto(process.env.GCM_TEST_URL ?? 'http://127.0.0.1:5178/gcm')
 await page.getByRole('button', { name: 'Start', exact: true }).waitFor()
 const result = await page.evaluate(async ({ referenceColors, upstream }) => {
  const { GCM } = await import('/src/model/climate/gcm/index.ts')
  const config = GCM.DEFAULT_CONFIG
  const { PASTA_HYDROLOGY: WATER } = await import('/src/model/climate/classification/pasta/hydrology/index.ts')
  const { GCM_NAMELIST: NAMELIST } = await import('/src/model/climate/gcm/namelist/index.ts')
  const { PASTA } = await import('/src/model/climate/classification/pasta/index.ts')
  const { GCM_CLASSIFICATION: C } = await import('/src/model/climate/gcm/classification/index.ts')
  const { KOPPEN } = await import('/src/model/climate/classification/koppen/index.ts')
  const { KOPPEN_OCEAN } = await import('/src/model/climate/classification/koppen/ocean/index.ts')
  const { GCM_AVERAGES: A } = await import('/src/model/climate/gcm/averages/index.ts')
  const { GCM_FIELDS: F } = await import('/src/model/climate/gcm/fields/index.ts')
  const { GCM_DOWNSCALE: D } = await import('/src/model/climate/gcm/downscale/index.ts')
  const { GCM_GRID: G } = await import('/src/model/climate/gcm/grid/index.ts')
  const { GCM_MODE_GROUPS } = await import('/src/ui/gcm/map-mode-options.ts')
  const { GCM_HOVER: H } = await import('/src/ui/gcm/hover/index.ts')
  const { GCM_DISPLAY: DISPLAY } = await import('/src/ui/gcm/field-display.ts')
  const check = condition => { if (!condition) throw new Error('Climate verification failed') }
  const repeated = value => Array(12).fill(value)
  const oceanCases = [
   [18, 0, 0, 'SeaTemp'], [18.001, 0, 0, 'SeaTrop'],
   [25, 0, 0.2, 'SeaTrop'], [25, 0, 0.201, 'SeaSeasonalIce'],
   [25, 0.8, 1, 'SeaSeasonalIce'], [25, 0.801, 1, 'SeaPermIce'],
   [-5, 0, 0, 'SeaTemp'], [-5, 0.9, 1, 'SeaPermIce'],
  ]
  for (const [minimumTemperatureC, minimumIceFraction, maximumIceFraction, expected] of oceanCases)
   check(KOPPEN_OCEAN.classify({ minimumTemperatureC, minimumIceFraction, maximumIceFraction }) === expected)
  const oceanIds = ['SeaTrop', 'SeaTemp', 'SeaSeasonalIce', 'SeaPermIce'].map(code => KOPPEN.koppenLabels.indexOf(code))
  const oceanClasses = new Uint8Array(5)
  const seaIcePercentMonthly = new Float32Array(60)
  for (let month = 0; month < 12; month++) {
   seaIcePercentMonthly[month * 5 + 2] = month === 0 ? 30 : 0
   seaIcePercentMonthly[month * 5 + 3] = 90
  }
  KOPPEN.koppenCells({ start: 0, end: 5, isLand: new Uint8Array([0,0,0,0,1]), temperatureMonthly: new Float32Array(60).fill(25), rainfallMonthly: new Float32Array(60).fill(100), surfaceTemperatureMonthly: Float32Array.from({length:60}, (_, index) => index % 5 === 1 ? 10 : 25), seaIcePercentMonthly, classes: oceanClasses })
  check(oceanClasses.every((id, point) => point < 4 ? id === oceanIds[point] : KOPPEN.koppenLabels[id] === 'Af'))
  seaIcePercentMonthly.fill(20)
  KOPPEN.koppenCells({ start: 0, end: 4, isLand: new Uint8Array(5), temperatureMonthly: new Float32Array(60), rainfallMonthly: new Float32Array(60), surfaceTemperatureMonthly: new Float32Array(60).fill(25), seaIcePercentMonthly, classes: oceanClasses })
  check(oceanClasses.slice(0, 4).every(id => id === oceanIds[0]))
  seaIcePercentMonthly.fill(80)
  KOPPEN.koppenCells({ start: 0, end: 4, isLand: new Uint8Array(5), temperatureMonthly: new Float32Array(60), rainfallMonthly: new Float32Array(60), surfaceTemperatureMonthly: new Float32Array(60).fill(25), seaIcePercentMonthly, classes: oceanClasses })
  check(oceanClasses.slice(0, 4).every(id => id === oceanIds[2]))
  const oceanColors = [[9,120,171], [113,171,216], [185,227,255], [226,248,255]]
  oceanIds.forEach((id, index) => check(KOPPEN.koppenClimateColor(id).every((value, channel) => Math.round(value * 255) === oceanColors[index][channel])))
  const base = { monthDays: 30, pressureHpa: repeated(1013.25), hydrology: null, land: true, downscaled: false, temperature: repeated(25), minimum: repeated(10), maximum: repeated(35), rainfall: repeated(200), light: repeated(250), surfaceTemperature: repeated(25), seaIce: repeated(0), snow: repeated(0) }
  if (referenceColors) {
   check(Object.keys(referenceColors).length === 104)
   for (const [code, expected] of Object.entries(referenceColors)) {
    const zone = PASTA.CLASSES.find(zone => zone.code === code)
    check(zone && zone.color.every((value, channel) => value === expected[channel] / 255))
   }
   check(PASTA.CLASSES.length === 105)
  }
  const code = patch => PASTA.CLASSES[PASTA.classify({ ...base, ...patch })].code
  const cases = [
   [{}, 'TUr'], [{ rainfall: repeated(1000) }, 'TUrp'], [{ rainfall: repeated(0) }, 'Aha'],
   [{ rainfall: repeated(0), minimum: repeated(-20) }, 'Ahc'],
   [{ minimum: repeated(-1) }, 'CTf'], [{ minimum: repeated(-20) }, 'CDb'],
   [{ temperature: repeated(10), minimum: repeated(-10) }, 'CDap'],
   [{ temperature: [-15,-15,-15,-10,0,5,12,12,5,0,-10,-15], minimum: repeated(-30) }, 'CEbp'],
   [{ temperature: [-15,-15,-15,-10,0,5,12,12,5,0,-10,-15], minimum: repeated(-70) }, 'CEcp'],
   [{ temperature: [-15,-15,-15,-10,0,0,8,0,0,0,-10,-15], minimum: repeated(-30) }, 'CFb'],
   [{ temperature: [-15,-15,-15,-10,0,0,1,0,0,0,-10,-15], minimum: repeated(-30) }, 'CG'],
   [{ temperature: repeated(-10), minimum: repeated(-20), maximum: repeated(-1), surfaceTemperature: repeated(-10), snow: repeated(20) }, 'CI'],
   [{ snow: repeated(20) }, 'CI'], [{ snow: repeated(20), downscaled: true }, 'TUr'],
   [{ temperature: repeated(-10), minimum: repeated(-20), maximum: repeated(-1), snow: [20,...Array(11).fill(0)], downscaled: true }, 'CI'],
   [{ maximum: repeated(55) }, 'HTf'], [{ maximum: repeated(75) }, 'HDb'],
   [{ maximum: repeated(55), minimum: repeated(-2) }, 'ETf'], [{ maximum: repeated(75), minimum: repeated(-2) }, 'EDb'],
   [{ light: repeated(10) }, 'TF'], [{ light: repeated(0) }, 'TG'],
   [{ land: false }, 'Ot'], [{ land: false, seaIce: repeated(1) }, 'Ofi'],
   [{ land: false, seaIce: [1,...Array(11).fill(0)] }, 'Ofd'], [{ land: false, light: repeated(0) }, 'Og'],
   [{ land: false, surfaceTemperature: repeated(65) }, 'Or'],
   [{ pressureHpa: repeated(90), maximum: repeated(45) }, 'HDc'],
   [{ pressureHpa: repeated(90), maximum: repeated(45), minimum: repeated(-2) }, 'EDb'],
   [{ pressureHpa: repeated(2000), maximum: repeated(105) }, 'HDb'],
   [{ temperature: [0,0,0,0,0,10,0,0,0,0,0,0], minimum: repeated(-10) }, 'CFa'],
   [{ temperature: [0,0,0,0,0,10,0,0,0,0,0,0], minimum: repeated(-10), monthDays: 90 }, 'CEap'],
   [{ temperature: [0,0,0,0,0,10,0,0,0,0,0,0], minimum: repeated(-10), monthDays: 300 }, 'CDap'],
   [{ temperature: [8,8,8,0,8,8,8,8,8,8,8,8], minimum: repeated(-10) }, 'CEap'],
   [{ temperature: [0,...Array(11).fill(25)], minimum: repeated(-5) }, 'CTf'],
   [{ minimum: repeated(0) }, 'CTf'], [{ maximum: repeated(70) }, 'HTf'], [{ maximum: repeated(100) }, 'HDc'],
   [{ land: false, surfaceTemperature: repeated(18) }, 'Oc'],
   [{ land: false, surfaceTemperature: repeated(40) }, 'Ot'], [{ land: false, surfaceTemperature: repeated(60) }, 'Oh'],
   [{ land: false, seaIce: repeated(0.2) }, 'Ot'], [{ land: false, seaIce: repeated(0.8) }, 'Ofd'],
   [{ land: false, seaIce: repeated(0.8), light: repeated(0) }, 'Ofg'],
   [{ land: false, seaIce: [0,...Array(11).fill(0.9)], light: [0,...Array(11).fill(100)] }, 'Ofd'],
   [{ land: false, downscaled: true, snow: repeated(9) }, 'Ofi'],
   [{ land: false, downscaled: true, snow: [3,...Array(11).fill(0)] }, 'Ofd'],
  ]
  for (const [patch, expected] of cases) {
   const actual = code(patch)
   if (actual !== expected) throw new Error(`${expected}: got ${actual}`)
   for (let offset = 1; offset < 12; offset++) {
    const rotated = Object.fromEntries(Object.entries({ ...base, ...patch }).map(([key, value]) => [key, Array.isArray(value) ? [...value.slice(offset), ...value.slice(0, offset)] : value]))
    if (code(rotated) !== expected) throw new Error('Climate depends on calendar origin: ' + expected)
   }
  }
  const climate = GCM_MODE_GROUPS.find(group => group.label === 'Climate')
  check(climate.children.map(child => child.value).join(',') === 'koppen,pasta')
  check(GCM_MODE_GROUPS.find(group => group.label === 'Temperature').children.some(child => child.value === 'diurnalTemperatureRange' && child.label === 'DTR'))
  check(C.classes({ config, months: [], downscale: null, scheme: 'pasta' }) === null)
  check(NAMELIST.edits({ ...config, yearDays: 720, rotationPeriodDays: 2 }).plasim_namelist.N_DAYS_PER_YEAR === '360')
  const waterInput = { temperature: 25, netRadiationWm2: 100, humidityPercent: 50, pressureKpa: 101.325, windMs: 2, forestFraction: 0.5, gasConstant: 287.05, monthDays: 30 }
  const pet = WATER.potentialMonth(waterInput)
  check(pet > 0 && WATER.potentialMonth({ ...waterInput, monthDays: 60 }) === pet * 2)
  for (const test of upstream.petCases) {
   const actual = WATER.potentialMonth(test.input)
   check(Math.abs(actual - test.expected) <= 1e-10 * Math.max(1, Math.abs(test.expected)))
  }
  if (upstream.soilViewRegression) {
   const test = upstream.soilViewRegression
   const actual = WATER.evaporation({ rainfall: test.rainfall, potential: test.potential })
   check(test.upstream[0] === 0 && actual.every((value, month) => value === test.converged[month]))
  }
  const grid = G.forLatitudes(32)
  const averager = A.create()
  const makeSnapshot = ({ month, day, minimum, maximum }) => {
   const snapshot = { layers: 10, step: month * 48 + day, date: { year: 1, month, day, hour: 0, minute: 0 }, values: new Float32Array(grid.points * F.fieldCount(10)) }
   for (const [field, value] of Object.entries({ airTemperature: 298.15, airTemperatureMin: minimum, airTemperatureMax: maximum, surfaceTemperature: 298.15, precipitation: 200 / 30 / 86400000, surfaceShortwave: 200, albedo: 0.2, landFraction: 1, surfacePressure: 101325, evaporation: 175 / 30 / 86400000, layerHumidity10: 0.5 })) F.field({ snapshot, field }).fill(value)
   F.field({ snapshot, field: 'diurnalTemperatureRange' }).fill(month * 3)
   F.field({ snapshot, field: 'dailyTemperatureRangeSum' }).fill(month * (day === 1 ? 2 : 3))
   F.field({ snapshot, field: 'dailyTemperatureRangeDays' }).fill(day === 1 ? 2 : 1)
   return snapshot
  }
  for (let month = 1; month <= 12; month++) {
   A.add({ averager, snapshot: makeSnapshot({ month, day: 1, minimum: 283.15, maximum: 308.15 }) })
   A.add({ averager, snapshot: makeSnapshot({ month, day: 2, minimum: 278.15, maximum: 318.15 }) })
  }
  A.add({ averager, snapshot: makeSnapshot({ month: 1, day: 1, minimum: 283.15, maximum: 308.15 }) })
  check(averager.months.length === 12)
  const snapshot = averager.months[0].snapshot
  check(Math.abs(F.field({ snapshot, field: 'airTemperatureMin' })[0] - 278.15) < 0.001)
  check(Math.abs(F.field({ snapshot, field: 'airTemperatureMax' })[0] - 318.15) < 0.001)
  const dailyRange = F.values({ snapshot, mode: 'diurnalTemperatureRange' })
  check(dailyRange.every(value => Math.abs(value - 5 / 3) < 1e-5))
  check(F.values({ snapshot: A.annual(averager), mode: 'diurnalTemperatureRange' }).every(value => Math.abs(value - 65 / 6) < 1e-5))
  check(DISPLAY.format({ mode: 'diurnalTemperatureRange', value: 10, unitSystem: 'metric' }) === '10.0 °C')
  check(DISPLAY.format({ mode: 'diurnalTemperatureRange', value: 10, unitSystem: 'imperial' }) === '18.0 °F')
  const heldRange = { ...snapshot, values: snapshot.values.slice() }
  F.field({ snapshot: heldRange, field: 'dailyTemperatureRangeSum' }).fill(0)
  F.field({ snapshot: heldRange, field: 'dailyTemperatureRangeDays' }).fill(0)
  F.field({ snapshot: heldRange, field: 'diurnalTemperatureRange' }).fill(7)
  check(F.values({ snapshot: heldRange, mode: 'diurnalTemperatureRange' }).every(value => value === 7))
  const classes = C.classes({ config, months: averager.months, downscale: null, scheme: 'pasta' })
  check(classes.every(value => PASTA.CLASSES[value].code === 'TUr'))
  const terrain = { name: 'Flat land', width: 4, height: 2, elevationM: new Float32Array(8), land: new Float32Array(8).fill(1) }
  const downscale = D.create({ grid, terrain, factor: 1 })
  const oceanMonths = averager.months.map(month => {
   const snapshot = { ...month.snapshot, values: new Float32Array(month.snapshot.values) }
   F.field({ snapshot, field: 'landFraction' }).fill(0)
   F.field({ snapshot, field: 'surfaceTemperature' }).fill(300)
   F.field({ snapshot, field: 'airTemperature' }).fill(280)
   F.field({ snapshot, field: 'seaIce' }).fill(0)
   return { ...month, snapshot }
  })
  const oceanGrid = D.create({ grid, terrain: { ...terrain, land: new Float32Array(8) }, factor: 1 })
  for (const downscale of [null, oceanGrid]) {
   const classified = C.classes({ config, months: oceanMonths, downscale, scheme: 'koppen' })
   check(classified.every(id => id === oceanIds[0]))
  }
  for (const scheme of ['koppen', 'pasta']) {
   const model = C.classes({ config, months: averager.months, downscale: null, scheme })
   const fine = C.classes({ config, months: averager.months, downscale, scheme })
   check(fine.length === 8 && fine.every(value => value === model[0]))
   const layer = { kind: 'downscaled-classes', width: 4, height: 2, classes: fine, scheme }
   const rows = H.rows({ point: { latitude: 0, longitude: 0 }, layer, unitSystem: 'metric' })
   check(rows.at(-1).label === C.definition(scheme).label)
   check(rows.at(-1).value === C.definition(scheme).name(fine[0]))
  }
  const displayTerrain = { name: 'Display-size land', width: 720, height: 360, elevationM: new Float32Array(720 * 360), land: new Float32Array(720 * 360).fill(1) }
  const displayGrid = D.create({ grid, terrain: displayTerrain, factor: 1 })
  const displayClasses = C.classes({ config, months: averager.months, downscale: displayGrid, scheme: 'pasta' })
  check(displayClasses.length === 720 * 360 && displayClasses.every(value => value === classes[0]))
  const { createElement, Profiler } = (await import('/node_modules/.vite/deps/react.js')).default
  const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default
  const { flushSync } = (await import('/node_modules/.vite/deps/react-dom.js')).default
  const { GcmClimateLegend } = await import('/src/ui/gcm/GcmClimateLegend.tsx')
  const legendHost = document.body.appendChild(document.createElement('div'))
  const legendRoot = createRoot(legendHost)
  const renderLegend = props => createElement(Profiler, { id: 'climate-legend', onRender: () => {} }, createElement(GcmClimateLegend, props))
  flushSync(() => legendRoot.render(renderLegend({ readClasses: () => new Uint8Array(displayClasses.length).fill(1), scheme: 'koppen' })))
  performance.clearMeasures()
  const legendStarted = performance.now()
  flushSync(() => legendRoot.render(renderLegend({ readClasses: () => displayClasses, scheme: 'pasta' })))
  const legendSwitchMs = performance.now() - legendStarted
  check(legendHost.textContent === 'TUr')
  const legendMeasures = performance.getEntriesByType('measure').filter(entry => entry.name.includes('GcmClimateLegend'))
  check(legendMeasures.length > 0)
  const legendDiagnosticProperties = Math.max(...legendMeasures.map(entry => entry.detail?.devtools?.properties?.length ?? 0))
  check(legendDiagnosticProperties < 100)
  flushSync(() => legendRoot.render(renderLegend({ readClasses: () => new Uint8Array(displayClasses.length).fill(1), scheme: 'koppen' })))
  check(legendHost.textContent === 'Af')
  flushSync(() => legendRoot.render(renderLegend({ readClasses: () => Uint8Array.from(oceanIds), scheme: 'koppen' })))
  check(legendHost.textContent === 'SeaTropSeaTempSeaSeasonalIceSeaPermIce')
  check(legendHost.querySelector('[title="Permanent sea ice"]') !== null)
  flushSync(() => legendRoot.unmount())
  legendHost.remove()
  const dryMonths = averager.months.map(month => {
   const snapshot = { ...month.snapshot, values: new Float32Array(month.snapshot.values) }
   F.field({ snapshot, field: 'evaporation' }).fill(0)
   return { ...month, snapshot }
  })
  const dryClasses = C.classes({ config, months: dryMonths, downscale: null, scheme: 'pasta' })
  check(dryClasses.every(value => PASTA.CLASSES[value].code === 'Aha'))
  const rainMonths = averager.months.map(month => {
   const snapshot = { ...month.snapshot, values: new Float32Array(month.snapshot.values) }
   F.field({ snapshot, field: 'precipitation' }).fill(1 / 86400000)
   return { ...month, snapshot }
  })
  const shortRain = C.classes({ config, months: rainMonths, downscale: null, scheme: 'koppen' })
  const longRain = C.classes({ config: { ...config, yearDays: 720 }, months: rainMonths, downscale: null, scheme: 'koppen' })
  check(C.definition('koppen').code(shortRain[0]) === 'BSh' && C.definition('koppen').code(longRain[0]) === 'Af')
  for (let sample = 0; sample < 2000; sample++) {
   const temperature = Array.from(Array(12).keys(), month => -50 + sample % 100 + 30 * Math.sin(month * Math.PI / 6))
   const id = PASTA.classify({ ...base, temperature, minimum: temperature.map(value => value - 15), maximum: temperature.map(value => value + 15), rainfall: repeated(sample % 500), light: repeated(sample % 400) })
   check(id >= 0 && id < PASTA.CLASSES.length)
  }
  for (const store of globalThis.climateTestStores) store.update({ snapshot, averages: { months: averager.months, years: [], annual: A.annual(averager), koppen: C.classes({ config, months: averager.months, downscale: null, scheme: "koppen" }), pasta: classes } })
  return { koppenOceanCases: oceanCases.length, koppenOceanLegend: true, dailyTemperatureRange: true, legendSwitchMs, legendDiagnosticProperties, upstreamPetCases: upstream.petCases.length, yearLengthScaling: true, nativeAet: true, pressureBoiling: true, ascePetMm: pet, paletteMatched: referenceColors ? Object.keys(referenceColors).length : 0, cases: cases.length, seasonalFixtures: 2000, monthlyExtremaPreserved: true, bothDownscaledSchemes: true, displayPoints: displayClasses.length, hover: true, classes: PASTA.CLASSES.length }
 }, { referenceColors, upstream })
 assert.deepEqual(errors, [])
 await mkdir('stats/pasta', { recursive: true })
 await writeFile('stats/pasta/classification.json', JSON.stringify(result, null, 2))
 await page.getByRole('button', { name: 'Climate', exact: true }).click()
 await page.getByRole('button', { name: 'Köppen', exact: true }).waitFor()
 await page.getByRole('button', { name: 'Pasta', exact: true }).click()
 await page.getByText('TUr', { exact: true }).waitFor()
 assert.match(await page.getByRole('button', { name: 'Pasta', exact: true }).getAttribute('class'), /bg-white/)
 assert(await page.getByText('Pasta from the', { exact: false }).count())
 await page.screenshot({ path: 'stats/pasta/controls.png', fullPage: true })
 await page.getByRole('button', { name: 'Köppen', exact: true }).click()
 await page.getByText('Af', { exact: true }).waitFor()
 await page.getByRole('button', { name: 'Temperature', exact: true }).click()
 await page.getByRole('button', { name: 'DTR', exact: true }).click()
 await page.getByText('Daily temperature range · 2 m air', { exact: true }).waitFor()
 await page.getByRole('button', { name: 'Monthly', exact: true }).click()
 await page.getByRole('button', { name: 'Annual', exact: true }).click()
 await page.screenshot({ path: 'stats/pasta/dtr-controls.png', fullPage: true })
 assert.deepEqual(errors, [])
 console.log(JSON.stringify(result, null, 2))
} finally {
 await browser.close()
}
