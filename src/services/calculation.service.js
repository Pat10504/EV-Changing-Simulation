import { CSV_FIELDS } from '../config/constants.js'
import { calculatePwmSignal } from './pwm.service.js'

const DEFAULT_CONFIG = {
  transformer_mva: 50,
  limit_percent: 80,
  power_factor: 0.9,
}
const MIN_ACTIVE_CHARGER_POWER_KW = 20

export function calculate(record, config = DEFAULT_CONFIG) {
  const transformer_mva = Number(config.transformer_mva ?? DEFAULT_CONFIG.transformer_mva)
  const limit_percent = Number(config.limit_percent ?? DEFAULT_CONFIG.limit_percent)
  const power_factor = clampPowerFactor(config.power_factor ?? DEFAULT_CONFIG.power_factor)
  const base_load_percent = Number(record.base_load_percent ?? config.base_load_percent ?? 65)
  const sin_phi = Math.sqrt(1 - power_factor ** 2)

  // Transformer rating is apparent power. The simulation uses PF to derive P and Q.
  const transformer_kVA = transformer_mva * 1000
  const transformer_kW = transformer_kVA * power_factor
  const transformer_kVAr = transformer_kVA * sin_phi
  const base_load_kVA = transformer_kVA * (base_load_percent / 100)
  const base_load_kW = base_load_kVA * power_factor
  const base_load_kVAr = base_load_kVA * sin_phi
  const load_limit_kVA = transformer_kVA * (limit_percent / 100)
  const load_limit_kW = load_limit_kVA * power_factor

  let ev_load_kW = 0
  const charger_breakdown = {}
  const activeData = record.charger_data ?? record

  for (const [key, value] of Object.entries(activeData)) {
    if (key.startsWith(CSV_FIELDS.activePrefix)) {
      const size = parseInt(key.replace(CSV_FIELDS.activePrefix, '').replace('kW', ''))
      const active = Number(value || 0)
      const totalUnits = getTotalUnits(size, config.chargers)
      const load = active * size
      const loadKva = load / power_factor
      const loadKvar = loadKva * sin_phi
      ev_load_kW += load
      charger_breakdown[key] = { 
        active,
        total_units: totalUnits,
        size_kW: size, 
        load_kW: load,
        load_kVA: round(loadKva),
        load_kVAr: round(loadKvar),
        utilization_percent: totalUnits > 0 ? round((active / totalUnits) * 100) : 0,
      }
    }
  }

  const ev_load_kVA = ev_load_kW / power_factor
  const ev_load_kVAr = ev_load_kVA * sin_phi
  const total_load_kW = base_load_kW + ev_load_kW
  const total_load_kVAr = base_load_kVAr + ev_load_kVAr
  const total_load_kVA = Math.sqrt(total_load_kW ** 2 + total_load_kVAr ** 2)
  const total_load_percent = (total_load_kVA / transformer_kVA) * 100

  let status = 'NORMAL'
  if (total_load_percent > limit_percent) status = 'OVERLOAD'
  else if (total_load_percent > 70) status = 'WARNING'

  let over_limit_kVA = 0
  let over_limit_kW = 0
  let reduce_per_charger_kW = 0
  let actual_reduction_kW = 0
  let redistribution_extra_kW = 0
  const charger_adjusted = {}

  if (status === 'OVERLOAD') {
    over_limit_kVA = total_load_kVA - load_limit_kVA
    over_limit_kW = over_limit_kVA * power_factor
    const total_active = Object.values(charger_breakdown).reduce((sum, c) => sum + c.active, 0)
    reduce_per_charger_kW = total_active > 0 ? over_limit_kW / total_active : 0
    const reductionPlan = allocateReduction(charger_breakdown, over_limit_kW)

    for (const [key, c] of Object.entries(charger_breakdown)) {
      const minPowerKw = Math.min(c.size_kW, MIN_ACTIVE_CHARGER_POWER_KW)
      const plannedReductionKw = reductionPlan.reductionByKey[key] || 0
      const new_power_kW = Math.max(minPowerKw, c.size_kW - plannedReductionKw)
      const reduced_kW = c.size_kW - new_power_kW
      actual_reduction_kW += reduced_kW * c.active
      redistribution_extra_kW += Math.max(0, reduced_kW - reduce_per_charger_kW) * c.active
      charger_adjusted[key] = {
        original_kW: c.size_kW,
        min_power_kW: minPowerKw,
        new_power_kW: round(new_power_kW),
        reduced_kW: round(reduced_kW),
        new_power_percent: round((new_power_kW / c.size_kW) * 100),
        minimum_limited: new_power_kW === minPowerKw && plannedReductionKw >= c.size_kW - minPowerKw,
        redistributed_extra_kW: round(Math.max(0, reduced_kW - reduce_per_charger_kW)),
      }
    }
  }

  const unmet_reduction_kW = Math.max(0, over_limit_kW - actual_reduction_kW)
  const adjusted_ev_load_kW = Math.max(0, ev_load_kW - actual_reduction_kW)
  const adjusted_ev_load_kVA = adjusted_ev_load_kW / power_factor
  const adjusted_ev_load_kVAr = adjusted_ev_load_kVA * sin_phi
  const adjusted_total_load_kW = base_load_kW + adjusted_ev_load_kW
  const adjusted_total_load_kVAr = base_load_kVAr + adjusted_ev_load_kVAr
  const adjusted_total_load_kVA = Math.sqrt(adjusted_total_load_kW ** 2 + adjusted_total_load_kVAr ** 2)
  const adjusted_total_load_percent = (adjusted_total_load_kVA / transformer_kVA) * 100
  const remaining_over_limit_kVA = Math.max(0, adjusted_total_load_kVA - load_limit_kVA)

  const pwmSignal = calculatePwmSignal({
    status,
    chargerBreakdown: charger_breakdown,
    chargerAdjusted: charger_adjusted,
  })

  return {
    time: record.time ?? record.time_slot,
    power_factor,
    sin_phi: round(sin_phi),
    transformer_kVA,
    transformer_kW,
    transformer_kVAr: round(transformer_kVAr),
    transformer_mva,
    base_load_percent,
    base_load_kVA: round(base_load_kVA),
    base_load_kW: round(base_load_kW),
    base_load_kVAr: round(base_load_kVAr),
    load_limit_kVA: round(load_limit_kVA),
    load_limit_kW: round(load_limit_kW),
    ev_load_kVA: round(ev_load_kVA),
    ev_load_kW,
    ev_load_kVAr: round(ev_load_kVAr),
    total_load_kVA: round(total_load_kVA),
    total_load_kW: round(total_load_kW),
    total_load_kVAr: round(total_load_kVAr),
    total_load_percent: round(total_load_percent),
    status,
    over_limit_kVA: round(over_limit_kVA),
    over_limit_kW: round(over_limit_kW),
    reduce_per_charger_kW: round(reduce_per_charger_kW),
    min_charger_power_kW: MIN_ACTIVE_CHARGER_POWER_KW,
    actual_reduction_kW: round(actual_reduction_kW),
    redistribution_extra_kW: round(redistribution_extra_kW),
    redistribution_applied: redistribution_extra_kW > 0,
    unmet_reduction_kW: round(unmet_reduction_kW),
    control_limited: unmet_reduction_kW > 0,
    adjusted_ev_load_kW: round(adjusted_ev_load_kW),
    adjusted_ev_load_kVA: round(adjusted_ev_load_kVA),
    adjusted_total_load_kVA: round(adjusted_total_load_kVA),
    adjusted_total_load_percent: round(adjusted_total_load_percent),
    remaining_over_limit_kVA: round(remaining_over_limit_kVA),
    charger_breakdown,
    charger_adjusted,
    ...pwmSignal,
  }
}

function getTotalUnits(size, chargers = []) {
  const match = chargers.find((charger) => Number(charger.charger_kw) === Number(size))
  return Number(match?.total_units || 0)
}

function allocateReduction(chargerBreakdown, requiredReductionKw) {
  const entries = Object.entries(chargerBreakdown)
    .map(([key, charger]) => ({
      key,
      active: Number(charger.active || 0),
      maxReductionPerCharger: Math.max(
        0,
        Number(charger.size_kW || 0) - Math.min(Number(charger.size_kW || 0), MIN_ACTIVE_CHARGER_POWER_KW)
      ),
    }))
    .filter((entry) => entry.active > 0)

  const reductionByKey = Object.fromEntries(entries.map((entry) => [entry.key, 0]))
  let remainingReductionKw = Math.max(0, requiredReductionKw)
  let adjustableEntries = entries

  while (remainingReductionKw > 0.000001 && adjustableEntries.length > 0) {
    const activeCount = adjustableEntries.reduce((sum, entry) => sum + entry.active, 0)
    if (activeCount <= 0) break

    const equalReductionKw = remainingReductionKw / activeCount
    let usedThisRoundKw = 0

    adjustableEntries = adjustableEntries.filter((entry) => {
      const headroomKw = entry.maxReductionPerCharger - reductionByKey[entry.key]
      const appliedKw = Math.min(equalReductionKw, headroomKw)
      reductionByKey[entry.key] += appliedKw
      usedThisRoundKw += appliedKw * entry.active
      return headroomKw - appliedKw > 0.000001
    })

    if (usedThisRoundKw <= 0.000001) break
    remainingReductionKw -= usedThisRoundKw
  }

  return {
    reductionByKey,
    unmetReductionKw: Math.max(0, remainingReductionKw),
  }
}

function clampPowerFactor(value) {
  const pf = Number(value)
  if (!Number.isFinite(pf)) return DEFAULT_CONFIG.power_factor
  return Math.max(0.1, Math.min(1, pf))
}

function round(value) {
  return Number(Number(value || 0).toFixed(2))
}
