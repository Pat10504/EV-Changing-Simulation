import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createBatchStore } from '../src/services/circuit-batch-store.js'
import { createCircuitBatchService } from '../src/services/circuit-batch.service.js'
import { createCircuitService } from '../src/services/circuit.service.js'

const config = {transformer_mva:50,limit_percent:80,power_factor:.9}
const inputs = {reference_voltage_V:400,initial_soc:.2,duration_s:.2,config,start_time:'18:30',end_time:'18:40',step_minutes:5}
const source = [
  {time_slot:'12:30',base_load_percent:50,charger_data:{active_50kW:20,active_150kW:10}},
  {time_slot:'18:30',base_load_percent:73.5,charger_data:{active_50kW:76,active_150kW:49}},
  {time_slot:'18:35',base_load_percent:74.38,charger_data:{active_50kW:80,active_150kW:51}},
  {time_slot:'18:40',base_load_percent:74.5,charger_data:{active_50kW:81,active_150kW:51}},
  {time_slot:'20:55',base_load_percent:77.88,charger_data:{active_50kW:68,active_150kW:43}},
  {time_slot:'23:55',base_load_percent:35,charger_data:{active_50kW:0,active_150kW:0}},
]
const measured = {summary:{power_kW:12.05,voltage_V:383,current_A:31.46,error_percent:.42,stable_tail:false},series:{time_s:[0,.2],power_kW:[0,12.05]},wall_time_s:14}
const response = (body,status=200) => ({ok:status<400,status,json:async()=>body})
async function until(predicate) {
  for (let n=0;n<150;n++) { if (predicate()) return; await new Promise(resolve=>setImmediate(resolve)) }
  assert.fail('Expected worker state was not reached')
}
function fixture(t, overrides={}) {
  const dir=mkdtempSync(join(tmpdir(),'ev-batch-')); t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const store=createBatchStore(dir), requests=[], gates=[], records=structuredClone(source)
  const deps={store,readRecords:async()=>records,readChargers:async()=>[{charger_kw:50,total_units:120},{charger_kw:150,total_units:60}],
    wait:()=>new Promise(resolve=>gates.push(resolve)),
    bridgeFetch:async(url,options)=>{
      requests.push({url,...options})
      if (url.endsWith('/status')) return response({matlab_ready:true,busy:false})
      if (options.method==='POST') return response({status:'running'})
      return response({status:'complete',result:measured})
    },...overrides}
  return {service:createCircuitBatchService(deps),deps,store,requests,gates,records}
}
test('preview freezes actual allocation, preserves LIMITED, skips no active, and validates scope', async t=>{
  const {service,records}=fixture(t)
  const batch=await service.create({...inputs,times:['20:55','18:35','23:55']})
  assert.deepEqual(batch.rows.map(r=>r.time),['18:35','20:55','23:55'])
  assert.equal(batch.rows[0].target_power_kW,12)
  assert.equal(batch.rows[0].target_current_A,30)
  assert.equal(batch.rows[1].control_status,'LIMITED')
  assert.equal(batch.rows[1].remaining_over_limit_kVA,420)
  assert.equal(batch.rows[2].status,'skipped')
  records[2].charger_data.active_50kW=1;batch.rows[0].target_power_kW=99
  assert.equal(service.read(batch.id).rows[0].source.charger_data.active_50kW,80)
  assert.equal(service.read(batch.id).rows[0].target_power_kW,12)
  for (const edit of [{times:['01:11']},{times:[]},{times:['18:35','18:35']},{start_time:'18:40',end_time:'18:30'},
    {step_minutes:0},{initial_soc:NaN},{config:{...config,power_factor:2}},{times:['12:30'],reference_voltage_V:200}]) {
    await assert.rejects(service.create({...inputs,...edit}),{status:400})
  }
})
test('sequential worker pauses after a result, resumes next slot and stops without launching remaining jobs',async t=>{
  const {service,requests,gates}=fixture(t)
  const batch=await service.create(inputs)
  service.action(batch.id,'start'); await until(()=>gates.length===1)
  assert.equal(requests.filter(r=>r.method==='POST').length,1)
  service.action(batch.id,'pause'); gates.shift()(); await until(service.idle)
  let saved=service.read(batch.id)
  assert.equal(saved.status,'paused'); assert.equal(saved.rows[0].status,'complete');assert.equal(saved.rows[1].status,'pending')
  service.action(batch.id,'start'); await until(()=>gates.length===1)
  service.action(batch.id,'stop'); gates.shift()(); await until(service.idle)
  saved=service.read(batch.id)
  assert.equal(saved.status,'stopped')
  assert.deepEqual(saved.rows.map(r=>r.status),['complete','complete','cancelled'])
  const sent=requests.filter(r=>r.method==='POST').map(r=>JSON.parse(r.body))
  assert.equal(sent.length,2); assert.equal(sent[1].target_power_kW,12)
  assert.equal(sent[0].initial_soc,sent[1].initial_soc)
  assert.deepEqual(service.result(batch.id,saved.rows[0].id).result.series,measured.series)
})
test('lost POST response is reconciled by UUID on resume without duplicate simulation',async t=>{
  let posts=0
  const {service}=fixture(t,{bridgeFetch:async(url,options)=>{
    if(url.endsWith('/status'))return response({matlab_ready:true,busy:false})
    if(options.method==='POST'){posts++;throw new Error('lost response')}
    return response({status:'complete',result:measured})
  }})
  const batch=await service.create({...inputs,times:['18:35']})
  service.action(batch.id,'start');await until(service.idle)
  assert.equal(service.read(batch.id).status,'paused');assert.equal(service.read(batch.id).rows[0].status,'submitting')
  service.action(batch.id,'start');await until(service.idle)
  assert.equal(service.read(batch.id).status,'complete');assert.equal(posts,1)
})
test('restart retains results, pauses pending work and checks old job before advancing',async t=>{
  const {service,deps,store}=fixture(t)
  const batch=await service.create(inputs)
  const disk=store.read(batch.id);disk.status='running';disk.rows[0].status='running';store.write(disk)
  let posts=0
  const restored=createCircuitBatchService({...deps,bridgeFetch:async(_url,options)=>{if(options.method==='POST')posts++;return response({message:'missing'},404)}})
  assert.equal(restored.read(batch.id).status,'paused')
  restored.action(batch.id,'start');await until(restored.idle)
  assert.equal(posts,0);assert.equal(restored.read(batch.id).rows[0].status,'failed')
  assert.equal(restored.read(batch.id).rows[1].status,'pending')
  const saved=store.read(batch.id);saved.rows[0].status='complete';saved.rows[0].summary=measured.summary;store.writeResult(saved.rows[0].id,measured);store.write(saved)
  const second=createCircuitBatchService(deps)
  assert.deepEqual(second.result(batch.id,saved.rows[0].id).result,measured)
  assert.match(second.csv(batch.id),/remaining_over_limit_kVA/)
  assert.match(second.csv(batch.id),/12.05/)
  assert.throws(()=>second.result(batch.id,'../anything'),{status:404})
  assert.throws(()=>store.read('../anything'),{status:400})
})
test('MATLAB failure pauses without fabricated data; user resume advances and reports partial failure',async t=>{
  let posts=0
  const {service}=fixture(t,{bridgeFetch:async(url,options)=>{
    if(url.endsWith('/status')) return response({matlab_ready:true,busy:false})
    if(options.method==='POST'){posts++;return response(posts===1?{status:'failed',message:'model error'}:{status:'complete',result:measured})}
  }})
  const batch=await service.create(inputs)
  service.action(batch.id,'start');await until(service.idle)
  assert.equal(posts,1);assert.equal(service.read(batch.id).status,'paused');assert.equal(service.read(batch.id).rows[0].summary,null)
  service.action(batch.id,'start');await until(service.idle)
  assert.equal(service.read(batch.id).status,'completed_with_errors');assert.equal(posts,3)
})
test('all inactive rows complete without MATLAB; one batch owns engine; manual start respects ownership',async t=>{
  const {service,requests,gates}=fixture(t)
  const inactive=await service.create({...inputs,times:['23:55']})
  service.action(inactive.id,'start');await until(service.idle)
  assert.equal(service.read(inactive.id).status,'complete');assert.equal(requests.length,0)
  const first=await service.create(inputs),second=await service.create(inputs)
  service.action(first.id,'start');await until(()=>gates.length===1)
  assert.throws(()=>service.action(second.id,'start'),{status:409})
  const manual=createCircuitService({isBatchBusy:service.ownsEngine})
  await assert.rejects(manual.run('unused',{}),{status:409})
  service.action(first.id,'stop');gates.shift()();await until(service.idle)
})
test('importing service factories cannot recover or rewrite a live application batch',t=>{
  const root=mkdtempSync(join(tmpdir(),'ev-import-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
  const store=createBatchStore(join(root,'runtime-data/circuit-batches'))
  const live={id:'c045e850-756c-4008-bbd7-996ae5f1ad32',created_at:'2026-11-14',status:'running',rows:[]}
  store.write(live)
  const moduleUrl=new URL('../src/services/circuit.service.js',import.meta.url).href
  const batchUrl=new URL('../src/services/circuit-batch.service.js',import.meta.url).href
  const result=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(moduleUrl)});await import(${JSON.stringify(batchUrl)});`],{cwd:root,encoding:'utf8'})
  assert.equal(result.status,0,result.stderr)
  assert.deepEqual(store.read(live.id),live)
})
test('timeout retains the accepted job and resumes by reading it rather than sending again',async t=>{
  const {service,requests}=fixture(t,{maxWaitMs:-1})
  const batch=await service.create({...inputs,times:['18:35']})
  service.action(batch.id,'start');await until(service.idle)
  assert.equal(service.read(batch.id).status,'paused')
  assert.equal(service.read(batch.id).rows[0].status,'running')
  assert.equal(service.ownsEngine(),true)
  service.action(batch.id,'start');await until(service.idle)
  assert.equal(service.read(batch.id).status,'complete')
  assert.equal(requests.filter(r=>r.method==='POST').length,1)
})

test('dashboard follows the worker through repeated full power, reduction, then inactivity', async t => {
  const {service, requests, records, gates} = fixture(t)
  const [full, same, reduced, inactive] = records
  same.charger_data = structuredClone(full.charger_data)
  same.base_load_percent = full.base_load_percent
  inactive.charger_data = {active_50kW: 0}
  const batch = await service.create({...inputs, times: [full, same, reduced, inactive].map(r => r.time_slot)})
  // Changing the live source must not alter this run.
  full.base_load_percent = 99
  service.action(batch.id, 'start')
  for (const [index, target] of [50, 50, 12].entries()) {
    await until(() => gates.length)
    const {frame, rows} = service.dashboard(batch.id)
    assert.equal(frame.index, index)
    assert.equal(frame.time, rows[index].time)
    assert.equal(frame.charger_adjusted.active_50kW.new_power_kW, target)
    assert.equal(frame.chartHistory.length, index)
    assert.equal(rows[index].summary, null)
    assert.ok(rows.slice(0, index).every(r => r.summary))
    gates.shift()()
  }
  await until(service.idle)
  const {frame, rows} = service.dashboard(batch.id)
  assert.equal(frame.time, inactive.time_slot)
  assert.equal(rows.at(-1).status, 'skipped')
  const jobs = requests.filter(r => r.method === 'POST').map(r => JSON.parse(r.body))
  assert.deepEqual(jobs.map(job => job.target_power_kW), [50, 50, 12])
  assert.equal(new Set(jobs.map(job => job.id)).size, 3)
})

test('daily context is frozen beyond the run range and history contains only measured slots', async t => {
  const {service,records,gates,store,deps}=fixture(t)
  const batch=await service.create({...inputs,times:['18:35']})
  assert.equal(batch.day_records, undefined)
  const original=await service.dayOverview(batch.id)
  records[0].base_load_percent=99
  assert.deepEqual(await service.dayOverview(batch.id),original)
  assert.equal(original.frames.length,records.length)
  assert.deepEqual(service.measurementsAt('18:35'),[])
  service.action(batch.id,'start')
  await until(()=>gates.length); gates.shift()(); await until(service.idle)
  assert.equal(service.measurementsAt('18:35')[0].measured_kW,measured.summary.power_kW)
  const legacy=store.read(batch.id)
  delete legacy.day_records
  store.write(legacy)
  records.find(r=>r.time_slot==='18:35').base_load_percent=10
  const restored=createCircuitBatchService(deps)
  const day=await restored.dayOverview(batch.id)
  assert.equal(day.source,'mixed')
  assert.equal(day.frames[0].base_load_percent,99)
  assert.equal(day.frames.find(r=>r.time==='18:35').base_load_percent,74.38)
})
