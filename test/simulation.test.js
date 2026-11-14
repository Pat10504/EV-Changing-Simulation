import test from 'node:test'
import assert from 'node:assert/strict'
import { createSimulation } from '../src/services/simulation.service.js'

const records = [
  { time_slot: '00:00', base_load_percent: 35, charger_data: { active_50kW: 4, active_150kW: 0 } },
  { time_slot: '18:35', base_load_percent: 74.38, charger_data: { active_50kW: 80, active_150kW: 51 } },
  { time_slot: '18:40', base_load_percent: 74.5, charger_data: { active_50kW: 81, active_150kW: 52 } },
  { time_slot: '20:55', base_load_percent: 77.88, charger_data: { active_50kW: 68, active_150kW: 43 } },
]
const settings = { transformer_mva: 50, limit_percent: 80, power_factor: .9, interval_ms: 400 }
async function setup(options = {}) {
  let tick = null
  const events = []
  const sim = createSimulation({ readRecords: async () => records, readChargers: async () => [
    { charger_kw: 50, total_units: 120 }, { charger_kw: 150, total_units: 60 },
  ], databaseConfigured: () => true, setTimer: callback => { tick = callback; return 1 }, clearTimer: () => { tick = null }, ...options })
  await sim.initSimulation({ emit: (event, payload) => events.push({ event, payload }) })
  return { sim, events, tick: () => tick?.(), latest: () => events.filter(e => e.event === 'simulation:update').at(-1)?.payload }
}
test('seek shows the chosen row while paused and resume starts at the following row', async () => {
  const { sim, latest, tick } = await setup()
  await sim.seekSimulation({ ...settings, start_time: '18:35' })
  assert.equal(latest().time, '18:35')
  assert.equal(latest().running, false)
  assert.equal(latest().charger_adjusted.active_150kW.new_power_kW, 30.76)
  assert.deepEqual(latest().chartHistory.map(r => r.time), ['00:00'])
  assert.equal(sim.getSimulationState().currentIndex, 2)
  await sim.startSimulation(settings)
  assert.equal(latest().time, '18:40')
  assert.equal(latest().running, true)
  tick()
  assert.equal(latest().time, '20:55')
  assert.equal(latest().control_limited, true)
  sim.pauseSimulation()
  tick()
  assert.equal(latest().time, '20:55')
})
test('start_time starts immediately at the chosen row, including last and first rows', async () => {
  const { sim, latest, tick } = await setup()
  await sim.startSimulation({ ...settings, start_time: '20:55' })
  assert.equal(latest().time, '20:55')
  assert.equal(latest().chartHistory.length, 3)
  tick()
  assert.equal(latest().time, '00:00')
  await sim.startSimulation({ ...settings, start_time: '00:00' })
  assert.equal(latest().index, 0)
  assert.equal(latest().chartHistory.length, 0)
  sim.pauseSimulation()
})
test('seek while playing stops the timer; reset clears the displayed result', async () => {
  const { sim, latest, tick } = await setup()
  await sim.startSimulation(settings)
  await sim.seekSimulation({ ...settings, start_time: '20:55' })
  tick()
  assert.equal(latest().time, '20:55')
  assert.equal(sim.getSimulationState().running, false)
  sim.resetSimulation()
  assert.equal(sim.getSimulationState().lastResult, null)
  assert.equal(sim.getSimulationState().currentIndex, 0)
  await sim.startSimulation(settings)
  assert.equal(latest().time, '00:00')
  sim.pauseSimulation()
})
test('invalid/nonexistent times and invalid settings leave the existing result unchanged', async () => {
  const { sim } = await setup()
  await sim.seekSimulation({ ...settings, start_time: '18:35' })
  for (const start_time of ['24:00', '18:37', '', null, 1835]) {
    await assert.rejects(sim.seekSimulation({ ...settings, start_time }), { status: 400 })
    assert.equal(sim.getSimulationState().lastResult.time, '18:35')
  }
  for (const invalid of [{power_factor:0},{limit_percent:101},{transformer_mva:0},{interval_ms:-1}]) {
    await assert.rejects(sim.startSimulation({ ...settings, ...invalid }), { status: 400 })
  }
})
test('no data produces a clear error and available times come from the dataset', async () => {
  const { sim } = await setup()
  assert.deepEqual(await sim.getAvailableTimes(), records.map(r => r.time_slot))
  const empty = await setup({ readRecords: async () => [] })
  await assert.rejects(empty.sim.startSimulation(settings), /ไม่พบข้อมูล/)
  assert.deepEqual(await empty.sim.getAvailableTimes(), [])
})
test('history is recalculated with the new settings; reconnect recovers paused result and history', async () => {
  const { sim, latest } = await setup()
  await sim.seekSimulation({ ...settings, power_factor: 1, start_time: '18:40' })
  const snapshot = sim.getSimulationState()
  assert.equal(snapshot.running, false)
  assert.equal(snapshot.lastResult.time, '18:40')
  assert.equal(snapshot.lastResult.chartHistory.length, 2)
  assert.equal(snapshot.lastResult.chartHistory[1].total_load_percent, 97.68)
  assert.equal(latest().power_factor, 1)
})
test('pause cancels an in-flight start, avoiding an unexpected restart after the read completes', async () => {
  const { sim } = await setup({ readRecords: async () => { await new Promise(resolve => setImmediate(resolve)); return records } })
  const starting = sim.startSimulation(settings)
  sim.pauseSimulation()
  await assert.rejects(starting, { status: 409 })
  assert.equal(sim.getSimulationState().running, false)
})
