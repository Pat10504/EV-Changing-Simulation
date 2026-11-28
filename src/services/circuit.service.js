import { localCircuitBridge } from './circuit-bridge.js'
import { randomUUID } from 'node:crypto'
import { getSimulationState } from './simulation.service.js'

const fail = (message, status = 400) => Object.assign(new Error(message), { status })
export function createCircuitService({ readState = getSimulationState, bridgeFetch, bridge = localCircuitBridge(bridgeFetch), isBatchBusy = () => false } = {}) {
  const experiments = new Map()
  function get(id) {
    const item = experiments.get(id)
    if (!item) throw fail('ไม่พบรอบทดลองนี้ เซิร์ฟเวอร์อาจเริ่มใหม่ กรุณาเลือกเวลาจาก Dashboard อีกครั้ง', 404)
    return item
  }
  function create(input) {
    const state = readState()
    const result = state.lastResult
    if (state.running) throw fail('พัก Dashboard หรือกดดูช่วงนี้ก่อนเปิดการทดลอง', 409)
    if (!result || result.time !== input.time || result.updatedAt !== input.updated_at) throw fail('ผลบนหน้าจอเปลี่ยนแล้ว กรุณาเลือกเวลาอีกครั้ง', 409)
    if (input.charger_kw !== 50) throw fail('ตัวอย่างแรกทดลองเฉพาะตู้ตัวแทน 50 kW')
    const charger = result.charger_breakdown.active_50kW
    const adjusted = result.charger_adjusted.active_50kW
    if (!charger?.active || !adjusted || adjusted.new_power_kW <= 0) throw fail('ช่วงนี้ไม่มีตู้ 50 kW ที่กำลังชาร์จ')
    if (experiments.size >= 30) {
      const expired = [...experiments].find(([,v]) => !['running','submitting','connection_error'].includes(v.status))
      if (!expired) throw fail('มีงานค้างมากเกินไป',409)
      experiments.delete(expired[0])
    }
    const item = { id: randomUUID(), status: 'ready', created_at: new Date().toISOString(),
      snapshot: { time: result.time, source_updated_at: result.updatedAt, charger_kw: 50,
        target_power_kW: adjusted.new_power_kW, active_units: charger.active,
        remaining_percent: adjusted.new_power_percent, config: structuredClone(state.config) },
      inputs: null, result: null, message: null }
    experiments.set(item.id, item)
    return structuredClone(item)
  }
  async function status() {
    try { return { bridge_ready: true, ...await bridge('/status') } }
    catch (error) { return { bridge_ready: false, matlab_ready: false, message: error.message } }
  }
  async function read(id) {
    const item = get(id)
    if (['running','connection_error'].includes(item.status)) {
      try {
        const job = await bridge(`/jobs/${id}`)
        item.status = job.status; item.result = job.result || null; item.message = job.message || null
      } catch (error) { item.message = error.message; if (error.status === 404) item.status = 'failed' }
    }
    return structuredClone(item)
  }
  async function run(id, body) {
    if (isBatchBusy()) throw fail('ชุดอัตโนมัติกำลังใช้ MATLAB หรือรอตรวจงานเดิม พักชุดนั้นให้จบรอบก่อน',409)
    const item = get(id)
    if (!['ready','connection_error'].includes(item.status)) throw fail('รอบนี้ส่งงานแล้ว ดูผลเดิมหรือสร้างรอบใหม่จาก Dashboard',409)
    const voltage = Number(body.reference_voltage_V), soc = Number(body.initial_soc), duration = Number(body.duration_s)
    if (![voltage,soc,duration].every(Number.isFinite) || voltage < 200 || voltage > 1000 || soc < .05 || soc > .95 || duration < .2 || duration > 2) throw fail('ตรวจแรงดันอ้างอิง 200–1,000 V, SOC 5–95% และเวลาวงจร 0.2–2 วินาที')
    if (item.snapshot.target_power_kW * 1000 / voltage > 125) throw fail('กระแสที่คำนวณเกินขอบเขตทดลอง 125 A กรุณาตรวจเงื่อนไขก่อนรัน')
    const inputs = { reference_voltage_V: voltage, initial_soc: soc, duration_s: duration }
    if (item.inputs && JSON.stringify(item.inputs) !== JSON.stringify(inputs)) throw fail('งานที่ส่งแล้วล็อกค่าตั้งไว้ กรุณาสร้างรอบใหม่เพื่อเปลี่ยนค่า',409)
    item.inputs = inputs; item.status = 'submitting'; item.message = null
    try {
      const job = await bridge('/jobs', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ id, target_power_kW:item.snapshot.target_power_kW, ...inputs }) })
      item.status = job.status; item.result = job.result || null; item.message = job.message || null
    } catch (error) {
      item.status = error.status >= 500 ? 'connection_error' : 'ready'
      if (item.status === 'ready') item.inputs = null
      item.message = error.message
    }
    return structuredClone(item)
  }
  return { create, read, run, status }
}
