import test from 'node:test'
import assert from 'node:assert/strict'
import { calculate } from '../src/services/calculation.service.js'
import { createCircuitService } from '../src/services/circuit.service.js'
const source = () => ({ running:false, config:{transformer_mva:50,limit_percent:80,power_factor:.9},
  lastResult:{...calculate({time_slot:'18:35',base_load_percent:74.38,charger_data:{active_50kW:80,active_150kW:51}}),updatedAt:'snapshot-one'} })
const selection = {time:'18:35',updated_at:'snapshot-one',charger_kw:50}
const inputs = {reference_voltage_V:400,initial_soc:.2,duration_s:.2}
const response = body => ({ok:true,json:async()=>body})
test('circuit snapshot uses the server allocation and remains frozen as Dashboard changes', async () => {
  const state = source()
  const service = createCircuitService({readState:()=>state})
  const item = service.create({...selection,target_power_kW:49})
  assert.equal(item.snapshot.target_power_kW,12)
  item.snapshot.target_power_kW=99
  state.lastResult.time='19:00'; state.config.power_factor=1
  const stored=await service.read(item.id)
  assert.equal(stored.snapshot.time,'18:35')
  assert.equal(stored.snapshot.target_power_kW,12)
  assert.equal(stored.snapshot.config.power_factor,.9)
})
test('running, stale, unsupported and inactive selections cannot start experiments', () => {
  const state=source(), service=createCircuitService({readState:()=>state})
  assert.throws(()=>service.create({...selection,updated_at:'old'}),{status:409})
  assert.throws(()=>service.create({...selection,charger_kw:150}),{status:400})
  state.running=true; assert.throws(()=>service.create(selection),{status:409})
  state.running=false; state.lastResult.charger_breakdown.active_50kW.active=0
  assert.throws(()=>service.create(selection),{status:400})
})
test('run validates current limit, sends only frozen power, locks inputs and retrieves the matching job', async () => {
  const requests=[]
  const service=createCircuitService({readState:source,bridgeFetch:async(url,options)=>{
    requests.push({url,...options})
    return response(options.method==='POST'?{status:'running'}:{status:'complete',result:{summary:{power_kW:12.05}}})
  }})
  const item=service.create(selection)
  await assert.rejects(service.run(item.id,{...inputs,reference_voltage_V:0}),{status:400})
  const job=await service.run(item.id,{...inputs,target_power_kW:50})
  assert.equal(job.status,'running')
  assert.equal(JSON.parse(requests[0].body).target_power_kW,12)
  await assert.rejects(service.run(item.id,inputs),{status:409})
  const done=await service.read(item.id)
  assert.equal(done.result.summary.power_kW,12.05)
  assert.ok(requests.at(-1).url.endsWith(`/jobs/${item.id}`))
})
test('bridge outage is explicit, retains retry identity and never fabricates results', async () => {
  const service=createCircuitService({readState:source,bridgeFetch:async()=>{throw new Error('offline')}})
  assert.equal((await service.status()).bridge_ready,false)
  const item=service.create(selection)
  const failed=await service.run(item.id,inputs)
  assert.equal(failed.status,'connection_error'); assert.equal(failed.result,null)
  await assert.rejects(service.run(item.id,{...inputs,reference_voltage_V:450}),{status:409})
  const retry=await service.run(item.id,inputs)
  assert.equal(retry.id,item.id)
})
