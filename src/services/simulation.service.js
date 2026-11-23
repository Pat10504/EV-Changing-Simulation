import { calculate } from './calculation.service.js'
import { getChargers, getLoadPatterns, isDatabaseConfigured } from './db.service.js'
import { config as appConfig } from '../config/index.js'

// A separate instance keeps playback tests independent of Supabase and real timers.
export function createSimulation({ readRecords = getLoadPatterns, readChargers = getChargers,
  databaseConfigured = isDatabaseConfigured, setTimer = setInterval, clearTimer = clearInterval } = {}) {
  let records = []
  let chargers = []
  let currentIndex = 0
  let intervalId = null
  let io = null
  let lastResult = null
  let revision = 0
  let currentConfig = {
    transformer_mva: appConfig.simulation.transformerMva,
    limit_percent: appConfig.simulation.limitPercent,
    power_factor: appConfig.simulation.powerFactor,
  }
  let currentIntervalMs = appConfig.simulation.defaultSpeedMs

  async function readDataset() {
    if (!databaseConfigured()) return [[], []]
    return Promise.all([readRecords(), readChargers()])
  }
  async function initSimulation(socketIo) {
    io = socketIo
    const version = revision
    const dataset = await readDataset()
    if (version === revision) [records, chargers] = dataset
  }
  function stopTimer() {
    if (intervalId !== null) clearTimer(intervalId)
    intervalId = null
  }
  function optionsConfig(options) {
    const next = {
      transformer_mva: Number(options.transformer_mva ?? currentConfig.transformer_mva),
      limit_percent: Number(options.limit_percent ?? currentConfig.limit_percent),
      power_factor: Number(options.power_factor ?? currentConfig.power_factor),
    }
    if (!Number.isFinite(next.transformer_mva) || next.transformer_mva <= 0) throw inputError('พิกัดหม้อแปลงต้องมากกว่า 0 MVA')
    if (!Number.isFinite(next.limit_percent) || next.limit_percent < 1 || next.limit_percent > 100) throw inputError('ขีดจำกัดโหลดต้องอยู่ระหว่าง 1–100%')
    if (!Number.isFinite(next.power_factor) || next.power_factor < .1 || next.power_factor > 1) throw inputError('Power Factor ต้องอยู่ระหว่าง 0.1–1')
    return next
  }
  async function prepare(options, requireTime = false) {
    const version = ++revision
    const nextConfig = optionsConfig(options)
    const intervalMs = Number(options.interval_ms ?? currentIntervalMs)
    if (!Number.isFinite(intervalMs) || intervalMs < 40 || intervalMs > 60000) throw inputError('ระยะเวลาแสดงผลต้องอยู่ระหว่าง 40–60,000 ms')
    const [nextRecords, nextChargers] = await readDataset()
    if (version !== revision) throw Object.assign(new Error('มีคำสั่งใหม่แล้ว กรุณาลองอีกครั้ง'), { status: 409 })
    if (!nextRecords.length) throw inputError('ไม่พบข้อมูล load_pattern กรุณาอัปโหลดไฟล์ CSV ก่อนเริ่มจำลอง')
    let index = currentIndex >= nextRecords.length ? 0 : currentIndex
    const hasTime = options.start_time !== undefined
    if (requireTime || hasTime) {
      if (typeof options.start_time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(options.start_time)) throw inputError('กรุณาเลือกเวลาในรูปแบบ HH:MM')
      index = nextRecords.findIndex(row => row.time_slot === options.start_time)
      if (index < 0) throw inputError(`ไม่มีข้อมูลเวลา ${options.start_time} ในตารางโหลด`)
    }
    return { nextRecords, nextChargers, nextConfig, intervalMs, index, hasTime }
  }
  function applyPrepared(next) {
    stopTimer()
    records = next.nextRecords
    chargers = next.nextChargers
    currentConfig = next.nextConfig
    currentIntervalMs = next.intervalMs
    currentIndex = next.index
  }
  function resultAt(index) { return calculate(records[index], { ...currentConfig, chargers }) }
  function chartHistory(beforeIndex) {
    return records.slice(0, beforeIndex).map((_record, index) => {
      const r = resultAt(index)
      return { time: r.time, index, base_load_percent: r.base_load_percent,
        adjusted_ev_load_kVA: r.adjusted_ev_load_kVA, transformer_kVA: r.transformer_kVA,
        total_load_percent: r.total_load_percent, load_limit_kVA: r.load_limit_kVA }
    })
  }
  function emitCurrent(includeHistory = false) {
    if (!records.length) return
    if (currentIndex >= records.length) currentIndex = 0
    lastResult = { ...resultAt(currentIndex), index: currentIndex, totalRecords: records.length,
      running: intervalId !== null, updatedAt: new Date().toISOString() }
    io?.emit('simulation:update', { ...lastResult, ...(includeHistory ? { chartHistory: chartHistory(currentIndex) } : {}) })
    currentIndex++
  }
  async function startSimulation(options = {}) {
    const next = await prepare(options)
    applyPrepared(next)
    intervalId = setTimer(() => emitCurrent(), currentIntervalMs)
    io?.emit('simulation:state', { status: 'running' })
    // Show the chosen/next row immediately; there is no wait from midnight.
    emitCurrent(true)
  }
  async function seekSimulation(options = {}) {
    const next = await prepare(options, true)
    applyPrepared(next)
    emitCurrent(true)
    io?.emit('simulation:state', { status: 'paused' })
    return lastResult
  }
  function pauseSimulation() {
    revision++
    stopTimer()
    io?.emit('simulation:state', { status: 'paused' })
  }
  function resetSimulation() {
    pauseSimulation()
    currentIndex = 0
    lastResult = null
    io?.emit('simulation:state', { status: 'reset' })
  }
  function clearSimulationCache() {
    resetSimulation()
    records = []
    chargers = []
    io?.emit('simulation:state', { status: 'dataset_changed' })
  }
  function getSimulationState() {
    return { running: intervalId !== null, currentIndex, totalRecords: records.length,
      intervalMs: currentIntervalMs, config: currentConfig, databaseConfigured: databaseConfigured(),
      lastResult: lastResult ? { ...lastResult, running: intervalId !== null, chartHistory: chartHistory(lastResult.index) } : null }
  }
  async function dayOverview(options = {}) {
    const config = optionsConfig(options)
    const [day, inventory] = await readDataset()
    return { source: 'current', frames: day.map(row => calculate(row, { ...config, chargers: inventory })) }
  }
  async function getAvailableTimes() {
    if (!databaseConfigured()) return []
    return (await readRecords()).map(row => row.time_slot)
  }
  return { initSimulation, startSimulation, seekSimulation, pauseSimulation, resetSimulation,
    clearSimulationCache, getSimulationState, getAvailableTimes, dayOverview }
}
function inputError(message) { return Object.assign(new Error(message), { status: 400 }) }

export const { initSimulation, startSimulation, seekSimulation, pauseSimulation, resetSimulation,
  clearSimulationCache, getSimulationState, getAvailableTimes, dayOverview } = createSimulation()
