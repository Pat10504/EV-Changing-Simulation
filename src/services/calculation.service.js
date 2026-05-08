import { CSV_FIELDS } from '../config/constants.js'
import { calculatePwmSignal } from './pwm.service.js'

const DEFAULT_CONFIG = {
  transformer_mva: 50,
  limit_percent: 80,
}

export function calculate(record, config = DEFAULT_CONFIG) {
  const transformer_mva = Number(config.transformer_mva ?? DEFAULT_CONFIG.transformer_mva)
  const limit_percent = Number(config.limit_percent ?? DEFAULT_CONFIG.limit_percent)
  const base_load_percent = Number(record.base_load_percent ?? config.base_load_percent ?? 65)

  // --- ค่าหม้อแปลง ---
  const transformer_kW = transformer_mva * 1000
  const base_load_kW = transformer_kW * (base_load_percent / 100)
  const load_limit_kW = transformer_kW * (limit_percent / 100)

  let ev_load_kW = 0
  const charger_breakdown = {}
  const activeData = record.charger_data ?? record

  for (const [key, value] of Object.entries(activeData)) {
    if (key.startsWith(CSV_FIELDS.activePrefix)) {
      const size = parseInt(key.replace(CSV_FIELDS.activePrefix, '').replace('kW', ''))
      const active = Number(value || 0)
      const totalUnits = getTotalUnits(size, config.chargers)
      const load = active * size
      ev_load_kW += load
      charger_breakdown[key] = { 
        active,
        total_units: totalUnits,
        size_kW: size, 
        load_kW: load,
        utilization_percent: totalUnits > 0 ? round((active / totalUnits) * 100) : 0,
      }
    }
  }

  // --- ภาระรวม ---
  const total_load_kW = base_load_kW + ev_load_kW
  const total_load_percent = (total_load_kW / transformer_kW) * 100

  // --- สถานะ ---
  let status = 'NORMAL'
  if (total_load_percent > limit_percent) status = 'OVERLOAD'
  else if (total_load_percent > 70) status = 'WARNING'

  // --- คำนวณเมื่อ Overload ---
  let over_limit_kW = 0
  let reduce_per_charger_kW = 0
  const charger_adjusted = {}

  if (status === 'OVERLOAD') {
    over_limit_kW = total_load_kW - load_limit_kW
    const total_active = Object.values(charger_breakdown).reduce((sum, c) => sum + c.active, 0)
    reduce_per_charger_kW = total_active > 0 ? over_limit_kW / total_active : 0

    for (const [key, c] of Object.entries(charger_breakdown)) {
      const new_power_kW = Math.max(0, c.size_kW - reduce_per_charger_kW)
      charger_adjusted[key] = {
        original_kW: c.size_kW,
        new_power_kW: round(new_power_kW),
        reduced_kW: round(c.size_kW - new_power_kW),
        new_power_percent: round((new_power_kW / c.size_kW) * 100),
      }
    }
  }

  const pwmSignal = calculatePwmSignal({
    status,
    chargerBreakdown: charger_breakdown,
    chargerAdjusted: charger_adjusted,
  })

  return {
    time: record.time ?? record.time_slot,
    transformer_kW,
    transformer_mva,
    base_load_percent,
    base_load_kW: round(base_load_kW),
    load_limit_kW,
    ev_load_kW,
    total_load_kW: round(total_load_kW),
    total_load_percent: round(total_load_percent),
    status,
    over_limit_kW: round(over_limit_kW),
    reduce_per_charger_kW: round(reduce_per_charger_kW),
    charger_breakdown,
    charger_adjusted,
    ...pwmSignal,
  }
}

function getTotalUnits(size, chargers = []) {
  const match = chargers.find((charger) => Number(charger.charger_kw) === Number(size))
  return Number(match?.total_units || 0)
}

function round(value) {
  return Number(Number(value || 0).toFixed(2))
}
