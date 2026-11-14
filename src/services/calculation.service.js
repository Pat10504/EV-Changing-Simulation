import { CSV_FIELDS } from '../config/constants.js'

const DEFAULT_CONFIG = {
  transformer_mva: 50,
  limit_percent: 80,
  power_factor: 0.9,
}
const MIN_ACTIVE_CHARGER_POWER_KW = 12
const EPSILON = 1e-6

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
  if (total_load_kVA - load_limit_kVA > EPSILON) status = 'OVERLOAD'
  else if (total_load_percent > 70) status = 'WARNING'

  const over_limit_kVA = Math.max(0, total_load_kVA - load_limit_kVA)
  const over_limit_kW = over_limit_kVA * power_factor
  const ev_budget_kW = Math.max(0, (load_limit_kVA - base_load_kVA) * power_factor)
  const initialRatio = ev_load_kW > 0 ? Math.min(1, ev_budget_kW / ev_load_kW) : 1
  const powerByKey = allocatePower(charger_breakdown, ev_budget_kW)
  let actual_reduction_kW = 0
  let redistribution_extra_kW = 0
  const charger_adjusted = {}

  for (const [key, c] of Object.entries(charger_breakdown)) {
    const minPowerKw = Math.min(c.size_kW, MIN_ACTIVE_CHARGER_POWER_KW)
    const active = c.active > 0
    const proportionalPowerKw = active ? c.size_kW * initialRatio : 0
    const new_power_kW = powerByKey[key] ?? 0
    const reduced_kW = active ? c.size_kW - new_power_kW : 0
    const extraReductionKw = Math.max(0, proportionalPowerKw - new_power_kW)
    actual_reduction_kW += reduced_kW * c.active
    redistribution_extra_kW += extraReductionKw * c.active
    charger_adjusted[key] = {
      active: c.active,
      original_kW: c.size_kW,
      min_power_kW: minPowerKw,
      minimum_supported: c.size_kW >= MIN_ACTIVE_CHARGER_POWER_KW,
      proportional_power_kW: round(proportionalPowerKw),
      new_power_kW: round(new_power_kW),
      reduced_kW: round(reduced_kW),
      new_power_percent: round((new_power_kW / c.size_kW) * 100),
      reduction_percent: active ? round((reduced_kW / c.size_kW) * 100) : 0,
      minimum_limited: active && status === 'OVERLOAD' && new_power_kW <= minPowerKw + EPSILON,
      redistributed_extra_kW: round(extraReductionKw),
      adjusted_load_kW: round(new_power_kW * c.active),
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
    allocation_method: 'proportional_with_minimum',
    ev_budget_kW: round(ev_budget_kW),
    initial_remaining_percent: round(initialRatio * 100),
    initial_reduction_percent: round((1 - initialRatio) * 100),
    min_charger_power_kW: MIN_ACTIVE_CHARGER_POWER_KW,
    actual_reduction_kW: round(actual_reduction_kW),
    redistribution_extra_kW: round(redistribution_extra_kW),
    redistribution_applied: redistribution_extra_kW > EPSILON,
    unmet_reduction_kW: round(unmet_reduction_kW),
    control_limited: unmet_reduction_kW > EPSILON,
    control_status: unmet_reduction_kW > EPSILON ? 'LIMITED' : status === 'OVERLOAD' ? 'ADJUSTED' : 'NOT_NEEDED',
    below_minimum_rating: Object.values(charger_breakdown).some(c => c.active > 0 && c.size_kW < MIN_ACTIVE_CHARGER_POWER_KW),
    adjusted_ev_load_kW: round(adjusted_ev_load_kW),
    adjusted_ev_load_kVA: round(adjusted_ev_load_kVA),
    adjusted_total_load_kVA: round(adjusted_total_load_kVA),
    adjusted_total_load_percent: round(adjusted_total_load_percent),
    remaining_over_limit_kVA: round(remaining_over_limit_kVA),
    charger_breakdown,
    charger_adjusted,
  }
}

function getTotalUnits(size, chargers = []) {
  const match = chargers.find((charger) => Number(charger.charger_kw) === Number(size))
  return Number(match?.total_units || 0)
}

function allocatePower(chargerBreakdown, budgetKw) {
  const entries = Object.entries(chargerBreakdown)
    .map(([key, charger]) => ({
      key,
      active: charger.active,
      rated: charger.size_kW,
      minimum: Math.min(charger.size_kW, MIN_ACTIVE_CHARGER_POWER_KW),
    }))
    .filter((entry) => entry.active > 0)

  const powerByKey = {}
  const minimumTotalKw = entries.reduce((sum, c) => sum + c.minimum * c.active, 0)
  // Keep the minimum even if infeasible; the caller reports the remaining overload.
  // This simulation never silently switches off chargers or changes CSV active counts.
  if (budgetKw <= minimumTotalKw) {
    return Object.fromEntries(entries.map(c => [c.key, c.minimum]))
  }

  let availableKw = budgetKw
  let adjustable = entries
  while (adjustable.length > 0) {
    const demandKw = adjustable.reduce((sum, c) => sum + c.rated * c.active, 0)
    const ratio = Math.min(1, Math.max(0, availableKw / demandKw))
    const atMinimum = adjustable.filter(c => c.rated * ratio < c.minimum)
    if (atMinimum.length === 0) {
      for (const c of adjustable) powerByKey[c.key] = c.rated * ratio
      break
    }
    // Freeze floor-bound groups, then recompute one common ratio for the rest.
    for (const c of atMinimum) {
      powerByKey[c.key] = c.minimum
      availableKw -= c.minimum * c.active
    }
    const fixedKeys = new Set(atMinimum.map(c => c.key))
    adjustable = adjustable.filter(c => !fixedKeys.has(c.key))
  }
  return powerByKey
}

function clampPowerFactor(value) {
  const pf = Number(value)
  if (!Number.isFinite(pf)) return DEFAULT_CONFIG.power_factor
  return Math.max(0.1, Math.min(1, pf))
}

function round(value) {
  return Number(Number(value || 0).toFixed(2))
}
