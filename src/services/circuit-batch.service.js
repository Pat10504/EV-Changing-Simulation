import { localCircuitBridge } from './circuit-bridge.js'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { getChargers, getLoadPatterns } from './db.service.js'
import { calculate } from './calculation.service.js'
import { createBatchStore } from './circuit-batch-store.js'

const fail = (message, status = 400) => Object.assign(new Error(message), { status })
const inFlight = row => ['submitting', 'running'].includes(row.status)
const terminal = row => ['complete', 'skipped', 'failed', 'cancelled'].includes(row.status)
const clock = () => new Date().toISOString()
const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3))

export function createCircuitBatchService({ store = createBatchStore(), readRecords = getLoadPatterns,
  readChargers = getChargers, onChange = () => {}, bridgeFetch, bridge = localCircuitBridge(bridgeFetch),
  wait = () => delay(1500), maxWaitMs = 600000 } = {}) {
  const batches = new Map()
  let worker = null
  // Never silently replay a job after a server restart. Resume reconciles its old UUID first.
  function restore(batch) {
    if (['running', 'pausing', 'stopping'].includes(batch.status)) {
      batch.stop_requested = batch.status === 'stopping'
      batch.status = 'paused'
      batch.message = 'เซิร์ฟเวอร์เริ่มใหม่ กดทำต่อเพื่อตรวจงานเดิมก่อนเดินไปช่วงถัดไป'
      store.write(batch)
    }
    batches.set(batch.id, batch)
  }
  for (const batch of store.list()) restore(batch)
  function save(batch) { batch.updated_at = clock(); store.write(batch); onChange(batch.id) }
  function get(id) {
    if (!batches.has(id)) {
      const saved = store.read(id)
      if (saved) restore(saved)
    }
    const batch = batches.get(id)
    if (!batch) throw fail('ไม่พบชุดทดลองนี้', 404)
    return batch
  }
  function view({ day_records, ...batch }) { return structuredClone(batch) }
  async function dayOverview(id) {
    const batch = get(id)
    let records = batch.day_records
    let source = 'saved'
    if (!records) {
      // Legacy runs saved only their selected slots. Those always take precedence.
      let current = []
      try { current = await readRecords() } catch { /* saved slots remain readable offline */ }
      const slots = new Map(current.map(row => [row.time_slot, row]))
      for (const row of batch.rows) slots.set(row.time, row.source)
      records = [...slots.values()].sort((a, b) => a.time_slot.localeCompare(b.time_slot))
      source = records.length > batch.rows.length ? 'mixed' : 'saved_slots'
    }
    return { source, frames: records.map(row => calculate(row, { ...batch.config, chargers: batch.chargers })) }
  }
  function ownsEngine() {
    return Boolean(worker) || [...batches.values()].some(b => b.rows.some(inFlight))
  }
  function dashboard(id) {
    const batch = get(id)
    // Older saved runs didn't record a cursor. Recover their last visited slot.
    const inferred = batch.rows.findLastIndex(row => row.started_at || row.status === 'failed')
    const last = batch.status.startsWith('complete') ? batch.rows.length - 1 : Math.max(0, inferred)
    const index = batch.current_index ?? last
    const frame = i => calculate(batch.rows[i].source, { ...batch.config, chargers: batch.chargers })
    const chartHistory = batch.rows.slice(0, index).map((_row, i) => {
      const { time, base_load_percent, adjusted_ev_load_kVA, transformer_kVA, total_load_percent, load_limit_kVA } = frame(i)
      return { time, base_load_percent, adjusted_ev_load_kVA, transformer_kVA, total_load_percent, load_limit_kVA }
    })
    return { ...view(batch), frame: { ...frame(index), index, totalRecords: batch.rows.length, chartHistory } }
  }
  async function create(input) {
    const inputs = { reference_voltage_V: Number(input.reference_voltage_V), initial_soc: Number(input.initial_soc), duration_s: Number(input.duration_s) }
    if (!Object.values(inputs).every(Number.isFinite) || inputs.reference_voltage_V < 200 || inputs.reference_voltage_V > 1000 || inputs.initial_soc < .05 || inputs.initial_soc > .95 || inputs.duration_s < .2 || inputs.duration_s > 2) throw fail('ตรวจแรงดัน 200–1,000 V, SOC 5–95% และเวลาวงจร 0.2–2 s')
    const config = Object.fromEntries(['transformer_mva', 'limit_percent', 'power_factor'].map(k => [k, Number(input.config?.[k])]))
    if (!Object.values(config).every(Number.isFinite) || config.transformer_mva <= 0 || config.limit_percent < 1 || config.limit_percent > 100 || config.power_factor < .1 || config.power_factor > 1) throw fail('ค่าหม้อแปลง ขีดจำกัด หรือ PF ไม่ถูกต้อง')
    const [records, chargers] = await Promise.all([readRecords(), readChargers()])
    if (!records.length || records.length > 288) throw fail('ต้องมีข้อมูลโหลด 1–288 แถว')
    let selected
    if (Array.isArray(input.times)) {
      if (!input.times.length || input.times.length > 288 || !input.times.every(validTime) || new Set(input.times).size !== input.times.length) throw fail('รายการเวลาไม่ถูกต้องหรือซ้ำกัน')
      if (input.times.some(t => !records.some(r => r.time_slot === t))) throw fail('มีเวลาที่ไม่อยู่ในข้อมูลโหลด')
      selected = records.filter(r => input.times.includes(r.time_slot))
    } else {
      const { start_time: start, end_time: end } = input
      const step = Number(input.step_minutes)
      if (!validTime(start) || !validTime(end) || start > end || !Number.isInteger(step) || step < 5 || step > 1440 || step % 5) throw fail('เลือกช่วงเวลาในวันเดียวกันและระยะห่างเป็นจำนวนเท่าของ 5 นาที')
      if (![start, end].every(t => records.some(r => r.time_slot === t))) throw fail('เวลาเริ่มหรือสิ้นสุดไม่มีในข้อมูลโหลด')
      selected = records.filter(r => r.time_slot >= start && r.time_slot <= end && (minutes(r.time_slot) - minutes(start)) % step === 0)
    }
    const rows = selected.sort((a, b) => a.time_slot.localeCompare(b.time_slot)).map(record => {
      const result = calculate(record, { ...config, chargers })
      const charger = result.charger_adjusted.active_50kW
      const target = charger?.new_power_kW ?? 0
      const active = charger?.active ?? 0
      if (!Number.isFinite(target) || target < 0 || target > 50 || target * 1000 / inputs.reference_voltage_V > 125) throw fail(`เวลา ${record.time_slot} มีกระแสเกินขอบเขต 125 A หรือกำลังไม่ถูกต้อง`)
      return { id: randomUUID(), time: record.time_slot, source: structuredClone(record), active_units: active,
        target_power_kW: target, target_current_A: target * 1000 / inputs.reference_voltage_V,
        control_status: result.control_status, remaining_over_limit_kVA: result.remaining_over_limit_kVA,
        minimum_limited: charger?.minimum_limited ?? false, status: active > 0 ? 'pending' : 'skipped',
        message: active > 0 ? null : 'ไม่มีตู้ 50 kW active จึงไม่รันวงจร', summary: null }
    })
    const batch = { id: randomUUID(), version: 1, mode: 'independent_snapshots', status: 'ready', created_at: clock(),
      inputs, config, day_records: structuredClone(records), chargers: structuredClone(chargers), charger_kw: 50, rows, message: null, stop_requested: false }
    save(batch); batches.set(batch.id, batch)
    return view(batch)
  }
  function finishStop(batch) {
    for (const row of batch.rows) if (row.status === 'pending') { row.status = 'cancelled'; row.message = 'หยุดชุดทดลองก่อนถึงรอบนี้' }
    batch.status = 'stopped'; batch.message = 'หยุดแล้ว ผลรอบที่เสร็จยังอยู่ครบ'; save(batch)
  }
  async function consume(batch, row, job) {
    const started = Date.now()
    while (['running', 'submitting'].includes(job.status)) {
      if (row.status !== 'running') { row.status = 'running'; save(batch) }
      if (Date.now() - started > maxWaitMs) throw fail('รอนานเกิน 10 นาที พักไว้โดยไม่ส่งงานซ้ำ กดทำต่อเพื่อตรวจงานเดิม', 504)
      await wait()
      job = await bridge(`/jobs/${row.id}`)
    }
    if (job.status === 'complete' && job.result?.summary &&
        ['power_kW', 'voltage_V', 'current_A', 'error_percent'].every(k => Number.isFinite(job.result.summary[k]))) {
      // Persist full measurements before marking the row complete.
      store.writeResult(row.id, job.result)
      row.summary = job.result.summary; row.wall_time_s = job.result.wall_time_s
      row.status = 'complete'; row.message = null; row.finished_at = clock(); save(batch)
    } else {
      row.status = 'failed'; row.message = job.message || 'MATLAB ไม่ได้ส่งผลวัดที่สมบูรณ์'; save(batch)
      throw fail(`เวลา ${row.time}: ${row.message} กดทำต่อเพื่อข้ามรอบที่ล้มเหลวไปช่วงถัดไป`, 422)
    }
  }
  async function process(batch) {
    try {
      for (const [index, row] of batch.rows.entries()) {
        if (row.status === 'skipped' && index > (batch.current_index ?? -1)) {
          if (batch.stop_requested) { finishStop(batch); return }
          if (batch.status === 'pausing') { batch.status = 'paused'; save(batch); return }
          batch.current_index = index
          save(batch)
        }
        if (terminal(row)) continue
        // Reconcile an accepted/uncertain job even when a stop has been requested.
        if (!inFlight(row)) {
          if (batch.stop_requested) { finishStop(batch); return }
          if (batch.status === 'pausing') { batch.status = 'paused'; save(batch); return }
          batch.current_index = index
          save(batch)
          const readiness = await bridge('/status')
          if (!readiness.matlab_ready || readiness.busy) throw fail(readiness.message || 'MATLAB ไม่พร้อมหรือมีงานอื่นอยู่ กดทำต่อเมื่อพร้อม', 409)
          // A pause may arrive while readiness is being checked.
          if (batch.stop_requested) { finishStop(batch); return }
          if (batch.status === 'pausing') { batch.status = 'paused'; save(batch); return }
          row.status = 'submitting'; row.started_at = clock(); save(batch)
          let job
          try { job = await bridge('/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: row.id, target_power_kW: row.target_power_kW, ...batch.inputs }) }) }
          catch (e) {
            // A definite rejection is safe to retry. A lost response must be reconciled by UUID.
            if (e.status >= 400 && e.status < 500) { row.status = 'pending'; save(batch) }
            throw e
          }
          await consume(batch, row, job)
        } else {
          const cached = store.readResult(row.id)
          if (cached) { await consume(batch, row, { status: 'complete', result: cached }); continue }
          let job
          try { job = await bridge(`/jobs/${row.id}`) }
          catch (e) {
            if (e.status === 404) {
              row.status = 'failed'; row.message = 'ไม่พบงานเดิมใน Python ไม่รันซ้ำอัตโนมัติเพราะยืนยันผลเดิมไม่ได้'; save(batch)
              throw fail(`${row.time}: ${row.message} กดทำต่อเพื่อข้ามไปช่วงถัดไป`, 422)
            }
            throw e
          }
          await consume(batch, row, job)
        }
      }
      if (batch.stop_requested) finishStop(batch)
      else { batch.status = batch.rows.some(r => r.status === 'failed') ? 'completed_with_errors' : 'complete'; batch.message = null; save(batch) }
    } catch (e) {
      batch.status = 'paused'; batch.message = e.message
      try { save(batch) } catch (storageError) { batch.message = `บันทึกผลไม่ได้: ${storageError.message}` }
    } finally { worker = null }
  }
  function launch(batch) { worker = batch.id; void process(batch) }
  function action(id, command) {
    const batch = get(id)
    if (command === 'start') {
      if (!['ready', 'paused'].includes(batch.status)) throw fail('ชุดนี้ไม่ได้อยู่ในสถานะพร้อมหรือพัก', 409)
      if (worker || [...batches.values()].some(b => b.id !== id && b.rows.some(inFlight))) throw fail('มีชุดทดลองอื่นกำลังทำงานหรือรอตรวจผลเดิม', 409)
      batch.status = batch.stop_requested ? 'stopping' : 'running'; batch.message = null; save(batch); launch(batch)
    } else if (command === 'pause') {
      if (batch.status !== 'running') throw fail('พักได้เฉพาะชุดที่กำลังรัน', 409)
      batch.status = 'pausing'; batch.message = 'พักหลังรอบปัจจุบันเสร็จ'; save(batch)
    } else if (command === 'stop') {
      if (!['ready', 'paused', 'running', 'pausing'].includes(batch.status)) throw fail('ชุดนี้หยุดไปแล้วหรือจบแล้ว', 409)
      batch.stop_requested = true
      if (worker === id) { batch.status = 'stopping'; batch.message = 'หยุดหลังรอบปัจจุบันเสร็จ'; save(batch) }
      else if (batch.rows.some(inFlight)) {
        if (worker) throw fail('รอชุดที่กำลังทำงานก่อน', 409)
        batch.status = 'stopping'; save(batch); launch(batch)
      } else finishStop(batch)
    } else throw fail('คำสั่งไม่ถูกต้อง')
    return view(batch)
  }
  function measurementsAt(time) {
    if (!validTime(time)) throw fail('เวลาไม่ถูกต้อง')
    return [...batches.values()].sort((a,b) => b.created_at.localeCompare(a.created_at)).flatMap(batch => {
      const row = batch.rows.find(r => r.time === time && r.status === 'complete' && r.summary)
      return row ? [{ id: batch.id, created_at: batch.created_at, config: batch.config,
        target_kW: row.target_power_kW, measured_kW: row.summary.power_kW }] : []
    })
  }
  function result(id, rowId) {
    const batch = get(id), row = batch.rows.find(r => r.id === rowId)
    if (!row || row.status !== 'complete') throw fail('รอบนี้ยังไม่มีผลวัด', 404)
    const data = store.readResult(row.id)
    if (!data) throw fail('ไม่พบไฟล์ผลวัดของรอบนี้', 404)
    return { snapshot: row, inputs: batch.inputs, result: data }
  }
  function csv(id) {
    const batch = get(id)
    const header = ['time','status','active_50kW','target_kW','target_A','measured_kW','measured_V','measured_A','error_percent','stable_tail','control_status','remaining_over_limit_kVA','reference_V','initial_SOC','circuit_duration_s','message']
    const escape = value => `"${(typeof value === 'string' ? value.replace(/^[=+@-]/, "'$&") : String(value ?? '')).replaceAll('"', '""')}"`
    return '\uFEFF' + [header, ...batch.rows.map(r => [r.time,r.status,r.active_units,r.target_power_kW,r.target_current_A,
      r.summary?.power_kW,r.summary?.voltage_V,r.summary?.current_A,r.summary?.error_percent,r.summary?.stable_tail,
      r.control_status,r.remaining_over_limit_kVA,batch.inputs.reference_voltage_V,batch.inputs.initial_soc,batch.inputs.duration_s,r.message])]
      .map(row => row.map(escape).join(',')).join('\r\n')
  }
  return { dashboard, dayOverview, measurementsAt, create, action, result, csv, ownsEngine, read: id => view(get(id)),
    list: () => [...batches.values()].sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(0,50)
      .map(b => ({ id:b.id,created_at:b.created_at,status:b.status,count:b.rows.length,start_time:b.rows[0]?.time,end_time:b.rows.at(-1)?.time,completed:b.rows.filter(r=>r.status==='complete').length })),
    idle: () => !worker }
}
