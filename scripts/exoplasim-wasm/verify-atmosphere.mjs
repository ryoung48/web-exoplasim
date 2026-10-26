import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {chromium} from 'playwright'
const output=path.resolve('stats/exoplasim-atmosphere')
await mkdir(output,{recursive:true})
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const page=await browser.newPage({viewport:{width:1440,height:1100}})
const errors=[]
page.on('pageerror',error=>errors.push(error.message))
try {
 await page.goto(process.env.GCM_TEST_URL ?? 'http://localhost:5174/gcm')
 const core=await page.evaluate(async()=>{
  const {GCM}=await import('/src/model/climate/gcm/index.ts')
  const {GCM_ATMOSPHERE:A}=await import('/src/model/climate/gcm/atmosphere/index.ts')
  const {GCM_NAMELIST:N}=await import('/src/model/climate/gcm/namelist/index.ts')
  const check=(condition,message)=>{if(!condition)throw new Error(message)}
  const close=(actual,expected)=>check(Math.abs(actual-expected)<1e-9*Math.max(1,Math.abs(expected)),`${actual} != ${expected}`)
  const resolve=config=>{const result=A.resolve(config);check(result.ok,result.message);return result.values}
  const defaults=resolve(A.DEFAULT_CONFIG)
  close(defaults.pressureBar,1.011)
  close(defaults.gasConstant,8314.46261815324/28.970253)
  close(defaults.co2Ppm,300)
  check(A.DEFAULT_CONFIG.ozone===false && Object.values(A.DEFAULT_CONFIG.partialPressures).every(value=>value===null),'Native defaults changed')
  const nativeEdits=N.edits(GCM.DEFAULT_CONFIG)
  close(+nativeEdits.plasim_namelist.PSURF,101100)
  close(+nativeEdits.planet_namelist.GASCON,defaults.gasConstant)
  check(nativeEdits.radmod_namelist.NO3==='0' && nativeEdits.radmod_namelist.CO2==='300','Native radiation defaults changed')
  const masses={H2:2.01588,He:4.002602,N2:28.0134,O2:31.9988,Ar:39.948,Ne:20.1797,Kr:83.798,CO2:44.01,H2O:18.01528}
  for(const [gas,mass]of Object.entries(masses)){
   const values=resolve({...A.DEFAULT_CONFIG,partialPressures:{...A.DEFAULT_CONFIG.partialPressures,[gas]:1}})
   close(values.pressureBar,1);close(values.gasConstant,8314.46261815324/mass)
  }
  const earth={...A.DEFAULT_CONFIG,partialPressures:{...A.DEFAULT_CONFIG.partialPressures,N2:0.7809,O2:0.2095,Ar:0.0093,CO2:0.0003}}
  const earthValues=resolve(earth)
  close(earthValues.pressureBar,1);close(earthValues.co2Ppm,300)
  close(earthValues.gasConstant,8314.46261815324/(0.7809*28.0134+0.2095*31.9988+0.0093*39.948+0.0003*44.01))
  const dry={...A.DEFAULT_CONFIG,partialPressures:{...A.DEFAULT_CONFIG.partialPressures,N2:1}}
  const wet={...dry,partialPressures:{...dry.partialPressures,H2O:0.1}}
  const dryEdits=N.edits({...GCM.DEFAULT_CONFIG,atmosphere:dry})
  const wetEdits=N.edits({...GCM.DEFAULT_CONFIG,atmosphere:wet})
  check(JSON.stringify(dryEdits.radmod_namelist)===JSON.stringify(wetEdits.radmod_namelist),'Bulk H2O changed radiation parameters')
  close(resolve(wet).pressureBar,1.1)
  const zero=resolve({...dry,partialPressures:{...dry.partialPressures,CO2:0}})
  check(zero.co2Ppm===0,'Explicit zero CO2 ignored')
  const direct={...A.DEFAULT_CONFIG,mode:'pressureAndGasConstant',pressureBar:2,gasConstant:300,partialPressures:{...A.DEFAULT_CONFIG.partialPressures,CO2:0.001,O2:0.2}}
  const directValues=resolve(direct)
  close(directValues.pressureBar,2);close(directValues.gasConstant,300);close(directValues.co2Ppm,500)
  const directEdits=N.edits({...GCM.DEFAULT_CONFIG,atmosphere:direct})
  close(+directEdits.plasim_namelist.PSURF,200000);close(+directEdits.planet_namelist.GASCON,300);close(+directEdits.radmod_namelist.CO2,500)
  for(const patch of [{pressureBar:0},{pressureBar:-1},{pressureBar:NaN},{gasConstant:0},{gasConstant:Infinity},{partialPressures:{...direct.partialPressures,N2:3}},{partialPressures:{...direct.partialPressures,He:-1}},{partialPressures:{...direct.partialPressures,H2O:NaN}}])check(!A.resolve({...direct,...patch}).ok,'Invalid atmosphere accepted')
  check(resolve({...direct,pressureBar:0.05,partialPressures:A.DEFAULT_CONFIG.partialPressures}).warnings.length>0,'Low-pressure guidance missing')
  check(resolve({...direct,pressureBar:11}).warnings.length>0,'High-pressure guidance missing')
  check(!resolve({...direct,pressureBar:10}).warnings.length,'Pressure boundary warning incorrect')
  return {defaults,earth:earthValues,direct:directValues,gases:Object.keys(masses).length,explicitZeroCo2:zero.co2Ppm,bulkH2oDoesNotSetRadiation:true}
 })
 console.log('Atmosphere core:',core)
 const simulations=await page.evaluate(async()=>{
  const {GCM}=await import('/src/model/climate/gcm/index.ts')
  const {GCM_ATMOSPHERE:A}=await import('/src/model/climate/gcm/atmosphere/index.ts')
  const {GCM_RUNNER:R}=await import('/src/model/climate/gcm/runner/index.ts')
  const {GCM_FIELDS:F}=await import('/src/model/climate/gcm/fields/index.ts')
  const {GCM_CHECKPOINT:C}=await import('/src/model/climate/gcm/checkpoint/index.ts')
  const {GCM_AVERAGES:M}=await import('/src/model/climate/gcm/averages/index.ts')
  const manifest=await R.manifest()
  const resolution=manifest.resolutions.find(entry=>entry.truncation===21&&entry.layers===10)
  const terrain={name:'Atmosphere fixture',width:4,height:2,elevationM:new Float32Array(8),land:new Float32Array([1,1,0,0,1,1,0,0])}
  const reports=[]
  for(const atmosphere of [A.DEFAULT_CONFIG,{...A.DEFAULT_CONFIG,partialPressures:{...A.DEFAULT_CONFIG.partialPressures,N2:0.7809,O2:0.2095,Ar:0.0093,CO2:0.0003}},{...A.DEFAULT_CONFIG,mode:'pressureAndGasConstant',pressureBar:0.5,gasConstant:300,ozone:true,partialPressures:{H2:0.001,He:0.001,N2:0.3,O2:0.1,Ar:0.01,Ne:0.00002,Kr:0.000001,CO2:0.0002,H2O:0.001}}]){
   const config={...GCM.DEFAULT_CONFIG,atmosphere,timestepMinutes:5}
   let run=null,first=null,latest=null
   const averager=M.create()
   const start=performance.now()
   try{
    await new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>reject(new Error('Atmosphere integration timed out')),120000)
     run=R.start({config,terrain,resolution,ranks:2,publishEvery:4,restart:null,startPaused:false,
      onSnapshot(snapshot){
       if(snapshot.values.length!==2048*F.fieldCount(10)||!snapshot.values.every(Number.isFinite)){clearTimeout(timer);reject(new Error('Invalid atmosphere fields'));return}
       first??=snapshot.step-4;latest=snapshot;M.add({averager,snapshot})
       if(snapshot.step-first>=48)run.checkpoint()
      },
      onStatus({status,message}){if(status==='failed'){clearTimeout(timer);reject(new Error(message))}},
      onCheckpoint(restart){
       clearTimeout(timer)
       try{
        const saved=C.decode(C.encode({terrain,meta:{format:C.FORMAT,config,precisionBytes:8,date:latest.date,step:latest.step},diagnostics:{snapshot:latest,averager},restart}))
        if(JSON.stringify(saved.meta.config.atmosphere)!==JSON.stringify(atmosphere))throw new Error('Atmosphere lost in checkpoint')
        resolve()
       }catch(error){reject(error)}
      }
     })
    })
    reports.push({mode:atmosphere.mode,steps:latest.step-first,timestepMinutes:5,elapsedMs:performance.now()-start,atmosphere:A.resolve(atmosphere).values})
   }finally{run?.stop()}
  }
  return reports
 })
 const gasInputs=[['Hydrogen (H₂)','0.01'],['Helium (He)','0.001'],['Nitrogen (N₂)','0.78'],['Oxygen (O₂)','0.2095'],['Argon (Ar)','0.0093'],['Neon (Ne)','0.000018'],['Krypton (Kr)','0.0000011'],['Carbon dioxide (CO₂)','0.0004'],['Water vapor (H₂O)','0.01']]
 for(const[label]of gasInputs)assert.equal(await page.getByRole('spinbutton',{name:label,exact:true}).inputValue(),'')
 assert.equal(await page.getByRole('checkbox',{name:'Ozone',exact:true}).isChecked(),false)
 assert.match(await page.locator('[aria-label="Resolved atmosphere"]').innerText(),/1.01100 bar/)
 await page.getByRole('button',{name:'Pressure + gas constant',exact:true}).click()
 await page.getByRole('spinbutton',{name:'Total surface pressure',exact:true}).fill('2')
 await page.getByRole('spinbutton',{name:'Effective gas constant',exact:true}).fill('300')
 for(const[label,value]of gasInputs)await page.getByRole('spinbutton',{name:label,exact:true}).fill(value)
 assert.match(await page.locator('[aria-label="Resolved atmosphere"]').innerText(),/200.00 ppm/)
 await page.getByRole('button',{name:'Gas mixture',exact:true}).click()
 assert.equal(await page.getByRole('spinbutton',{name:'Total surface pressure',exact:true}).count(),0)
 assert.match(await page.locator('[aria-label="Resolved atmosphere"]').innerText(),/1.02022 bar/)
 await page.getByRole('button',{name:'Pressure + gas constant',exact:true}).click()
 assert.equal(await page.getByRole('spinbutton',{name:'Total surface pressure',exact:true}).inputValue(),'2')
 await page.getByRole('spinbutton',{name:'Total surface pressure',exact:true}).fill('0.5')
 assert.match(await page.getByRole('alert').innerText(),/exceed/)
 await page.getByRole('spinbutton',{name:'Total surface pressure',exact:true}).fill('2')
 await page.getByRole('checkbox',{name:'Ozone',exact:true}).check()
 await page.getByRole('button',{name:'About Water vapor (H₂O)',exact:true}).focus()
 await page.getByRole('tooltip').waitFor()
 assert.match(await page.getByRole('tooltip').innerText(),/does not initialize humidity/)
 await page.screenshot({path:path.join(output,'water-vapor-help.png'),animations:'disabled'})
 await page.keyboard.press('Escape')
 await page.getByRole('button',{name:'5 min',exact:true}).click()
 await page.getByRole('button',{name:'Start',exact:true}).click()
 await page.getByRole('button',{name:'Pause',exact:true}).waitFor({timeout:120000})
 await page.waitForFunction(()=>!document.body.textContent.includes('No data yet'),null,{timeout:120000})
 await page.getByRole('button',{name:'Pause',exact:true}).click()
 assert.equal(await page.getByRole('spinbutton',{name:'Total surface pressure',exact:true}).isDisabled(),true)
 const downloaded=page.waitForEvent('download')
 await page.getByRole('button',{name:'Save',exact:true}).click()
 const download=await downloaded
 const saved=path.join(output,download.suggestedFilename())
 await download.saveAs(saved)
 await page.getByRole('button',{name:'Resume',exact:true}).waitFor()
 await page.getByRole('button',{name:'Clear',exact:true}).click()
 await page.getByRole('spinbutton',{name:'Total surface pressure',exact:true}).fill('3')
 await page.locator('input[type="file"][accept=".ckpt"]').setInputFiles(saved)
 await page.getByRole('button',{name:'Resume',exact:true}).waitFor({timeout:120000})
 assert.equal(await page.getByRole('spinbutton',{name:'Total surface pressure',exact:true}).inputValue(),'2')
 assert.equal(await page.getByRole('spinbutton',{name:'Effective gas constant',exact:true}).inputValue(),'300')
 for(const[label,value]of gasInputs)assert.equal(await page.getByRole('spinbutton',{name:label,exact:true}).inputValue(),value)
 assert.equal(await page.getByRole('checkbox',{name:'Ozone',exact:true}).isChecked(),true)
 await page.getByRole('spinbutton',{name:'Total surface pressure',exact:true}).scrollIntoViewIfNeeded()
 await page.screenshot({path:path.join(output,'direct-mode.png'),animations:'disabled'})
 await page.getByRole('button',{name:'Clear',exact:true}).click()
 for(const[label]of gasInputs)await page.getByRole('spinbutton',{name:label,exact:true}).fill('')
 await page.getByRole('spinbutton',{name:'Total surface pressure',exact:true}).fill('0.05')
 assert.match(await page.getByRole('status').innerText(),/5 minutes/)
 await page.getByRole('button',{name:'Gas mixture',exact:true}).click()
 assert.match(await page.locator('[aria-label="Resolved atmosphere"]').innerText(),/1.01100 bar/)
 await page.screenshot({path:path.join(output,'gas-mixture.png'),animations:'disabled'})
 assert.deepEqual(errors,[])
 await writeFile(path.join(output,'report.json'),JSON.stringify({core,simulations,errors},null,2))
 console.log('Atmosphere modes, nine gases, native defaults, short integrations and save/load passed')
}finally{await browser.close()}
