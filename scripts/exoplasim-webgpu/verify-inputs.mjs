import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const output = path.resolve('stats/gpu-inputs')
const fixtures = JSON.parse(await fs.readFile(path.join(output, 'native.json'), 'utf8'))
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' })
const report = { calendarCases: 0, solarCases: 0, glacierCases: 0 }
let browser
try {
 const load = (file) => server.ssrLoadModule(path.resolve(file))
 const { CALENDAR } = await load('src/model/climate/gcm/calendar/index.ts')
 const { RADIATION } = await load('src/model/climate/gcm/physics/radiation/index.ts')
 const { SETUP } = await load('src/model/climate/gcm/setup/index.ts')
 const { GCM_GRID } = await load('src/model/climate/gcm/grid/index.ts')
 const { GCM_BOUNDARY } = await load('src/model/climate/gcm/boundary/index.ts')
 const { GCM_NAMELIST } = await load('src/model/climate/gcm/namelist/index.ts')
 const { GCM_INPUTS } = await load('src/model/climate/gcm/runner/inputs/index.ts')
 for (const [height, expected] of [[-1, [true,true,true,true,true]], [0, [true,true,true,true,true]], [3, [false,false,false,false,true]]]) {
  const actual = ['N032_surf_0174.sra','N032_surf_1740.sra','N032_surf_0210.sra','N032_surf_0232.sra','N032_surf_0229.sra'].map(name => GCM_INPUTS.keepSurfaceFile({name,keepSurfaceFiles:true,namelistEdits:{glacier_namelist:{ICESHEETH:String(height)}}}))
  assert.deepEqual(actual, expected)
 }
 report.surfaceFileCases = 3
 const close = ({ actual, expected, tolerance = 2e-12 }) => assert(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} differs from native ${expected}`)
 for (const { input, expected } of fixtures.calendar) {
  const [daysPerYear, stepsPerDay, year, month, offset] = input
  const base = CALENDAR.startStep({ mtspd: stepsPerDay, year, month, daysPerYear, daysPerMonth: Math.trunc(daysPerYear / 12) })
  assert.equal(base, expected[0])
  const request = { step: base + offset, daysPerYear, stepsPerDay, stepMinutes: 1440 / stepsPerDay }
  assert.deepEqual(Object.values(CALENDAR.date(request)), expected.slice(1, 6))
  const interpolation = CALENDAR.monthInterpolation({ ...request, daysPerMonth: Math.trunc(daysPerYear / 12), solarDay: 86400 })
  assert.equal(interpolation.month, expected[6])
  assert.equal(interpolation.neighbour, expected[7])
  close({ actual: interpolation.weight, expected: expected[8] })
  report.calendarCases++
 }
 const solarCases = []
 for (const { input, expected } of fixtures.solar) {
  const [eccentricity, obliquityDeg, perihelionDeg, meanAnomalyDeg, kepler, fixed, longitudeDeg, step, stepsPerDay, stepsPerYear, stepMinutes, rotationSpeed] = input
  const orbit = CALENDAR.orbit({ fixed: true, eccentricity, obliquityDeg, perihelionDeg, meanAnomalyDeg, year: 2000 })
  const solar = CALENDAR.solar({ step, stepsPerDay, stepsPerYear, stepMinutes, orbit, keplerian: kepler === 1, synchronous: fixed === 1 })
  for (const [index, key] of ['calendarDay', 'declination', 'distanceFactor', 'trueAnomaly', 'longitude', 'rightAscension'].entries()) close({ actual: solar[key], expected: expected[index] })
  const values = RADIATION.step({ solar, rotationSpeed, toffo3: 0.25, keplerian: kepler === 1, fixedSun: fixed === 1 ? { longitudeDeg, declinationRad: orbit.obliquityRad } : null })
  values.forEach((actual, index) => close({ actual, expected: expected[6 + index] }))
  solarCases.push({ synchronous: fixed === 1, values: Array.from(values), expected: expected.slice(11) })
  report.solarCases++
 }
 const { files: packaged } = JSON.parse(await fs.readFile('public/gcm/t21/inputs.json', 'utf8'))
 const grid = GCM_GRID.forLatitudes(32)
 const ground = [0, 9806.65, -100, 1e-12, 19613.3]
 const boundary = GCM_BOUNDARY.files({ grid, landFraction: Float64Array.from({ length: grid.points }, (value, index) => index % ground.length === 0 ? 0 : 1), geopotential: Float64Array.from({ length: grid.points }, (value, index) => ground[index % ground.length]) })
 const terrainKey = 'N032_surf_0129.sra'
 boundary[terrainKey] = boundary[terrainKey].split('\n')[0] + '\n' + Array.from({ length: grid.points }, (value, index) => ground[index % ground.length]).join(' ') + '\n'
 for (const { height, expected } of fixtures.glacier.filter(({ height }) => height >= 0)) {
  const namelists = { ...Object.fromEntries(Object.entries(packaged).filter(([name]) => name.endsWith('_namelist'))), ...boundary }
  namelists.glacier_namelist = GCM_NAMELIST.apply({ text: namelists.glacier_namelist, values: { ICESHEETH: String(height), NGLACIER: '1' } })
  const state = SETUP.state({ truncation: 21, levels: 10, namelists, clock: 0 })
  assert.deepEqual(Array.from(state.fields.dglac.slice(0, 5)), expected.slice(0, 5))
  assert.deepEqual(Array.from(state.fields.dsnowz.slice(0, 5)), expected.slice(5))
  report.glacierCases++
 }
 await server.listen()
 browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-webgpu'] })
 const page = await browser.newPage()
 await page.goto(server.resolvedUrls.local[0])
 const gpu = await page.evaluate(async (cases) => {
  const { GCM_DEVICE } = await import('/src/model/climate/gcm/device/index.ts')
  const { LAYOUT } = await import('/src/model/climate/gcm/layout/index.ts')
  const { KERNEL } = await import('/src/model/climate/gcm/kernel/index.ts')
  const { RADIATION } = await import('/src/model/climate/gcm/physics/radiation/index.ts')
  const errors = []
  const { device } = await GCM_DEVICE.request({ storageBytes: 0, onLost: (message) => errors.push(message) })
  const dimensions = { truncation: 1, latitudes: 3, longitudes: 8, levels: 1 }
  const state = LAYOUT.create({ dimensions, fields: [{ name: 'gmu0', shape: 'grid', count: 1 }, { name: 'radiation_step', shape: 'table', count: 5 }] })
  const tables = LAYOUT.create({ dimensions, fields: [{ name: 'sid', shape: 'table', count: 3 }, { name: 'cola', shape: 'table', count: 3 }] })
  const context = KERNEL.context({ device, state, tables })
  for (const [name, values] of Object.entries({ sid: [-0.7, 0, 0.7], cola: [Math.sqrt(1 - 0.7 ** 2), 1, Math.sqrt(1 - 0.7 ** 2)] })) LAYOUT.write({ device, buffer: context.tableBuffer, layout: tables, name, values: Float32Array.from(values) })
  const kernels = await Promise.all([false, true].map((synchronous) => RADIATION.zenith({ context, dawnDeg: 0, synchronous })))
  let worstError = 0
  for (const item of cases) {
   LAYOUT.write({ device, buffer: context.stateBuffer, layout: state, name: 'radiation_step', values: Float32Array.from(item.values) })
   const encoder = device.createCommandEncoder()
   const pass = encoder.beginComputePass()
   KERNEL.dispatch({ pass, context, kernel: kernels[item.synchronous ? 1 : 0] })
   pass.end()
   device.queue.submit([encoder.finish()])
   const result = await LAYOUT.read({ device, buffer: context.stateBuffer, layout: state, names: ['gmu0'] })
   result.gmu0.forEach((value, index) => { worstError = Math.max(worstError, Math.abs(value - item.expected[index])) })
  }
  device.destroy()
  return { cases: cases.length, worstError, errors }
 }, solarCases)
 assert(gpu.worstError < 2e-6, `GPU zenith error ${gpu.worstError}`)
 assert.deepEqual(gpu.errors, [])
 report.gpu = gpu
 report.runs = await page.evaluate(async () => {
  const { GCM } = await import('/src/model/climate/gcm/index.ts')
  const { GCM_RUNNER } = await import('/src/model/climate/gcm/runner/index.ts')
  const { GCM_FIELDS } = await import('/src/model/climate/gcm/fields/index.ts')
  const resolutions = await GCM_RUNNER.resolutions()
  const terrain = { name: 'Input-support continent', width: 4, height: 2, elevationM: new Float32Array([1000,1000,0,0,1000,1000,0,0]), land: new Float32Array([1,1,0,0,1,1,0,0]) }
  const rows = []
  const presets = {
   synchronous: { synchronous: true, substellarLongitudeDeg: 90 },
   keplerian: { keplerian: true, eccentricity: 0.3, periapseLongitudeDeg: 45, initialMeanAnomalyDeg: 90 },
   glacier: { glaciers: { ...GCM.DEFAULT_CONFIG.glaciers, initialHeightM: 3 } },
   gregorian: { yearDays: 365 },
  }
  const wait = async (predicate) => {
   const until = performance.now() + 90000
   while (!predicate()) {
    if (performance.now() > until) throw new Error('GPU input run timed out')
    await new Promise(resolve => setTimeout(resolve, 20))
   }
  }
  const fingerprint = (snapshot) => {
   let hash = 2166136261
   for (const value of new Uint32Array(snapshot.values.buffer, snapshot.values.byteOffset, snapshot.values.length)) hash = Math.imul(hash ^ value, 16777619)
   return hash >>> 0
  }
  for (const truncation of [21,42]) for (const layers of [5,10]) for (const [name, preset] of Object.entries(presets)) {
   let run
   let latest
   let first
   let failure
   try {
    const config = { ...GCM.DEFAULT_CONFIG, ...preset, truncation, layers, earthSurfaceClimatology: name === 'glacier' }
    const resolution = resolutions.find(entry => entry.truncation === truncation && entry.layers === layers)
    run = GCM_RUNNER.start({ engine: 'gpu', ranks: null, config, terrain, resolution, publishEvery: 4, restart: null, averager: null, startPaused: false,
     onSnapshot(snapshot) { first ??= snapshot.step; latest = snapshot },
     onAverages() {}, onDevice() {}, onCheckpoint() {},
     onStatus({ status, message }) { if(status === 'failed') failure = message },
    })
    await wait(() => failure || latest && latest.step >= first + 48)
    if(failure) throw new Error(`${name} T${truncation} L${layers}: ${failure}`)
    if(!latest.values.every(Number.isFinite)) throw new Error('Nonfinite model state')
    const minimum=GCM_FIELDS.field({snapshot:latest,field:'airTemperatureMin'})
    const maximum=GCM_FIELDS.field({snapshot:latest,field:'airTemperatureMax'})
    if(!GCM_FIELDS.field({snapshot:latest,field:'airTemperature'}).every((value,index)=>minimum[index]<=value && value<=maximum[index])) throw new Error('Invalid extrema')
    rows.push({ name, truncation, layers, steps:latest.step-first, date:latest.date, finite:true })
   } finally { run?.stop() }
  }
  for (const synchronous of [false,true]) {
   let run
   let latest
   let first
   let saved
   let failure
   let paused = false
   let requested = false
   const original = new Map()
   const resumed = new Map()
   const config = { ...GCM.DEFAULT_CONFIG, ...presets.keplerian, ...presets.glacier, yearDays:365, synchronous, substellarLongitudeDeg:90, earthSurfaceClimatology:false }
   const resolution = resolutions.find(entry => entry.truncation === 21 && entry.layers === 10)
   const onStatus = ({status,message}) => { if(status==='failed') failure=message; if(status==='paused') paused=true }
   try {
    const base = { engine:'gpu', ranks:null, config, terrain, resolution, publishEvery:128, onAverages(){}, onDevice(){}, onStatus }
    run=GCM_RUNNER.start({...base,restart:null,averager:null,startPaused:false,
     onSnapshot(snapshot){ latest=snapshot; first??=snapshot.step; original.set(snapshot.step,fingerprint(snapshot)); if(!requested && snapshot.step>=first+128){requested=true;run.checkpoint()} },
     onCheckpoint(checkpoint){saved={...checkpoint,step:latest.step}},
    })
    await wait(()=>failure || saved)
    if(failure) throw new Error(failure)
    await wait(()=>failure || latest.step>=saved.step+512)
    if(failure) throw new Error(failure)
    run.stop()
    run=GCM_RUNNER.start({...base,restart:saved.restart,averager:saved.averager,startPaused:true,
     onSnapshot(snapshot){latest=snapshot;resumed.set(snapshot.step,fingerprint(snapshot))},onCheckpoint(){},
    })
    await wait(()=>failure || paused)
    if(failure) throw new Error(failure)
    run.resume()
    await wait(()=>failure || resumed.size>=4)
    if(failure) throw new Error(failure)
    const common=Array.from(resumed).filter(([step])=>original.has(step))
    if(common.length<3 || !common.every(([step,hash])=>hash===original.get(step))) throw new Error('New input checkpoint continuation differs')
    rows.push({name:'checkpoint',synchronous,keplerian:true,yearDays:365,glacierHeightM:3,comparedSteps:common.map(([step])=>step),identical:true})
   } finally {run?.stop()}
  }
  return rows
 })
 await page.addInitScript(() => {
  window.inputUiSnapshot = null
  window.inputUiFiles = null
  const Original = window.Worker
  // Capture the page's real worker inputs and output for the UI wiring check.
  window.Worker = class extends Original {
   constructor(...args) { super(...args); this.addEventListener('message', ({data}) => { if(data.type === 'progress') window.inputUiSnapshot = data.latest }) }
   postMessage(message, ...args) { if(message.type === 'start') window.inputUiFiles = message.files; return super.postMessage(message, ...args) }
  }
 })
 await page.goto(new URL('gcm', server.resolvedUrls.local[0]).href)
 await page.getByRole('checkbox', {name:'Generic Keplerian orbit', exact:true}).check()
 await page.getByRole('checkbox', {name:'Initial orbital phase override', exact:true}).check()
 await page.getByRole('slider', {name:'Initial orbital phase', exact:true}).fill('90')
 await page.getByRole('checkbox', {name:'Tidally locked illumination', exact:true}).check()
 await page.getByRole('slider', {name:'Year length', exact:true}).fill('365')
 assert.equal(await page.getByRole('button', {name:'Every step', exact:true}).count(), 0)
 await page.getByRole('button', {name:'Start', exact:true}).click()
 await page.waitForFunction(() => window.inputUiSnapshot !== null, {}, {timeout:60000})
 report.ui = await page.evaluate(() => ({ date:window.inputUiSnapshot.date, finite:window.inputUiSnapshot.values.every(Number.isFinite), keplerian:/NGENKEPLERIAN\s*=\s*1/.test(window.inputUiFiles.planet_namelist), synchronous:/NFIXED\s*=\s*1/.test(window.inputUiFiles.radmod_namelist), year365:/N_DAYS_PER_YEAR\s*=\s*365/.test(window.inputUiFiles.plasim_namelist) }))
 assert(report.ui.finite && report.ui.keplerian && report.ui.synchronous && report.ui.year365)
 await page.getByRole('button', {name:'Clear', exact:true}).click()
 await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2))
 console.log(JSON.stringify(report, null, 2))
} finally {
 await browser?.close()
 await server.close()
}
