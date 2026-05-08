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
}
let currentIntervalMs = appConfig.simulation.defaultSpeedMs

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
  currentIntervalMs = Number(options.interval_ms || currentIntervalMs)

  if (intervalId) return

  intervalId = setInterval(() => {
    if (currentIndex >= records.length) {
      currentIndex = 0
    }

    const record = records[currentIndex]
    const result = calculate(record, {
      ...currentConfig,
      chargers,
    })

    io?.emit('simulation:update', {
      ...result,
      index: currentIndex,
      totalRecords: records.length,
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
  }
}
