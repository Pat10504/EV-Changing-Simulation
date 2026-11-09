import { calculate } from './calculation.service.js'
import { getChargers, getLoadPatterns, isDatabaseConfigured } from './db.service.js'
import { SIMULATION_SIGNAL } from '../config/constants.js'
import { config as appConfig } from '../config/index.js'

let records = []
let chargers = []
let currentIndex = 0
let intervalId = null
let io = null
let currentConfig = {
  transformer_mva: appConfig.simulation.transformerMva,
  limit_percent: appConfig.simulation.limitPercent,
  power_factor: appConfig.simulation.powerFactor,
}
let currentIntervalMs = appConfig.simulation.defaultSpeedMs
let latestResult = null

export const initSimulation = async (socketIo) => {
  io = socketIo
  await loadRecords()
}

export const startSimulation = async (options = {}) => {
  await loadRecords()

  if (records.length === 0) {
    throw new Error('ไม่พบข้อมูล load_pattern กรุณาอัปโหลดไฟล์ CSV ก่อนเริ่มจำลอง')
  }

  currentConfig = buildSimulationConfig(options)
  const nextIntervalMs = Number(options.interval_ms || currentIntervalMs)

  if (intervalId && nextIntervalMs === currentIntervalMs) return
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }

  currentIntervalMs = nextIntervalMs

  intervalId = setInterval(() => {
    if (currentIndex >= records.length) {
      currentIndex = 0
    }

    const record = records[currentIndex]
    const result = calculate(record, {
      ...currentConfig,
      chargers,
    })
    latestResult = {
      ...result,
      index: currentIndex,
      totalRecords: records.length,
      updatedAt: new Date().toISOString(),
    }

    io?.emit('simulation:update', {
      ...latestResult,
      signal: { ...SIMULATION_SIGNAL, realtime: true },
    })

    currentIndex++
  }, currentIntervalMs)
}

export const pauseSimulation = () => {
  clearInterval(intervalId)
  intervalId = null
  io?.emit('simulation:state', { status: 'paused' })
}

export const resetSimulation = () => {
  pauseSimulation()
  currentIndex = 0
  latestResult = null
  io?.emit('simulation:state', { status: 'reset' })
}

export function clearSimulationCache() {
  resetSimulation()
  records = []
  chargers = []
}

export function getSimulationState() {
  return {
    running: Boolean(intervalId),
    currentIndex,
    totalRecords: records.length,
    intervalMs: currentIntervalMs,
    config: currentConfig,
    databaseConfigured: isDatabaseConfigured(),
  }
}

export function getHardwareLatest() {
  if (!latestResult) {
    return {
      has_data: false,
      running: Boolean(intervalId),
      status: 'NO_DATA',
      message: 'ยังไม่มีข้อมูลล่าสุด กรุณาเริ่ม simulation บน Dashboard ก่อน',
    }
  }

  return {
    has_data: true,
    running: Boolean(intervalId),
    interval_ms: currentIntervalMs,
    time: latestResult.time,
    status: latestResult.status,
    pwm: latestResult.pwm,
    pwm_voltage: latestResult.pwm_voltage,
    pwm_watt_sim_kW: latestResult.pwm_watt_sim_kW,
    pwm_source_kW: latestResult.pwm_source_kW,
    total_load_percent: latestResult.total_load_percent,
    total_load_kVA: latestResult.total_load_kVA,
    total_load_kW: latestResult.total_load_kW,
    base_load_kVA: latestResult.base_load_kVA,
    ev_load_kW: latestResult.ev_load_kW,
    over_limit_kW: latestResult.over_limit_kW,
    reduce_per_charger_kW: latestResult.reduce_per_charger_kW,
    min_charger_power_kW: latestResult.min_charger_power_kW,
    actual_reduction_kW: latestResult.actual_reduction_kW,
    redistribution_extra_kW: latestResult.redistribution_extra_kW,
    redistribution_applied: latestResult.redistribution_applied,
    unmet_reduction_kW: latestResult.unmet_reduction_kW,
    control_limited: latestResult.control_limited,
    adjusted_total_load_percent: latestResult.adjusted_total_load_percent,
    remaining_over_limit_kVA: latestResult.remaining_over_limit_kVA,
    index: latestResult.index,
    totalRecords: latestResult.totalRecords,
    updatedAt: latestResult.updatedAt,
  }
}

async function loadRecords() {
  if (!isDatabaseConfigured()) {
    records = []
    chargers = []
    return
  }

  const [dbRecords, dbChargers] = await Promise.all([
    getLoadPatterns(),
    getChargers(),
  ])

  records = dbRecords
  chargers = dbChargers
}

function buildSimulationConfig(options) {
  return {
    transformer_mva: Number(options.transformer_mva || currentConfig.transformer_mva),
    limit_percent: Number(options.limit_percent || currentConfig.limit_percent),
    power_factor: Number(options.power_factor || currentConfig.power_factor),
  }
}
