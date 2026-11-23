import test from 'node:test'
import assert from 'node:assert/strict'
import { calculate } from '../src/services/calculation.service.js'

const config = { transformer_mva: 50, limit_percent: 80, power_factor: .9, chargers: [{ charger_kw: 50, total_units: 120 }, { charger_kw: 150, total_units: 60 }] }
const run = (base, small, large) => calculate({ base_load_percent: base, charger_data: { active_50kW: small, active_150kW: large } }, config)
const near = (actual, expected, tolerance = .011) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)

test('18:00 reduces the same percentage, not the same kW per charger', () => {
  const r = run(73.5, 76, 49)
  near(r.ev_budget_kW, 2925)
  near(r.initial_reduction_percent, 73.77)
  near(r.charger_adjusted.active_50kW.new_power_kW, 13.12)
  near(r.charger_adjusted.active_150kW.new_power_kW, 39.35)
  assert.equal(r.charger_adjusted.active_50kW.reduction_percent, r.charger_adjusted.active_150kW.reduction_percent)
  assert.equal(r.redistribution_applied, false)
  assert.equal(r.control_limited, false)
  near(r.adjusted_total_load_kVA, 40000)
})
test('18:55 freezes small chargers at 12 and redistributes to large chargers', () => {
  const r = run(74.88, 84, 53)
  near(r.charger_adjusted.active_50kW.proportional_power_kW, 9.48)
  near(r.charger_adjusted.active_150kW.proportional_power_kW, 28.44)
  near(r.charger_adjusted.active_50kW.new_power_kW, 12)
  near(r.charger_adjusted.active_150kW.new_power_kW, 1296 / 53)
  near(r.redistribution_extra_kW, (12 - 2304 / 12150 * 50) * 84)
  assert.equal(r.charger_adjusted.active_50kW.minimum_limited, true)
  assert.equal(r.charger_adjusted.active_150kW.minimum_limited, false)
  assert.equal(r.control_status, 'ADJUSTED')
  near(r.adjusted_ev_load_kW, 2304)
})
test('20:10 still fits while 20:55 reports the actual residual overload', () => {
  const fit = run(76.75, 73, 46)
  near(fit.charger_adjusted.active_150kW.new_power_kW, 12.75)
  assert.equal(fit.control_limited, false)
  const r = run(77.88, 68, 43)
  near(r.ev_budget_kW, 954)
  near(r.adjusted_ev_load_kW, 1332)
  near(r.unmet_reduction_kW, 378)
  near(r.remaining_over_limit_kVA, 420)
  near(r.adjusted_total_load_percent, 80.84)
  assert.equal(r.control_status, 'LIMITED')
  assert.equal(r.charger_breakdown.active_50kW.active, 68)
  assert.equal(r.charger_breakdown.active_150kW.active, 43)
})
test('no overload: active gets rated power; inactive consumes nothing', () => {
  const r = run(35, 4, 0)
  near(r.charger_adjusted.active_50kW.new_power_kW, 50)
  near(r.charger_adjusted.active_150kW.new_power_kW, 0)
  assert.equal(r.charger_adjusted.active_150kW.minimum_limited, false)
  near(r.actual_reduction_kW, 0)
  assert.equal(r.control_status, 'NOT_NEEDED')
})
test('no active chargers and base-only overload remain explicit', () => {
  for (const base of [0, 80, 85]) {
    const r = run(base, 0, 0)
    near(r.adjusted_ev_load_kW, 0)
    assert.equal(r.control_limited, base > 80)
    near(r.adjusted_total_load_kVA, 50000 * base / 100)
    for (const a of Object.values(r.charger_adjusted)) assert.equal(a.minimum_limited, false)
  }
})
test('exact minimum budget is feasible and one cent below is infeasible', () => {
  const record = { base_load_percent: 0, charger_data: { active_50kW: 1, active_150kW: 1 } }
  const r = calculate(record, { transformer_mva: .024, limit_percent: 100, power_factor: 1 })
  near(r.adjusted_ev_load_kW, 24)
  assert.equal(r.control_limited, false)
  const limited = calculate(record, { transformer_mva: .02399, limit_percent: 100, power_factor: 1 })
  assert.equal(limited.control_limited, true)
})
test('multiple sizes freeze in stages; ordering does not change allocations', () => {
  const groups = { active_20kW: 2, active_50kW: 3, active_100kW: 4, active_150kW: 5 }
  const settings = { transformer_mva: .23, limit_percent: 100, power_factor: 1 }
  const r = calculate({ base_load_percent: 0, charger_data: groups }, settings)
  const reordered = calculate({ base_load_percent: 0, charger_data: Object.fromEntries(Object.entries(groups).reverse()) }, settings)
  near(r.charger_adjusted.active_20kW.new_power_kW, 12)
  near(r.charger_adjusted.active_50kW.new_power_kW, 12)
  near(r.charger_adjusted.active_100kW.new_power_kW, 170 / 1150 * 100)
  near(r.charger_adjusted.active_150kW.new_power_kW, 170 / 1150 * 150)
  near(r.adjusted_ev_load_kW, 230)
  assert.deepEqual(r.charger_adjusted, reordered.charger_adjusted)
})
test('input rated below 12 is flagged and never allocated above rating', () => {
  const r = calculate({ base_load_percent: 0, charger_data: { active_7kW: 2 } }, { transformer_mva: .001, limit_percent: 100, power_factor: 1 })
  assert.equal(r.below_minimum_rating, true)
  assert.equal(r.charger_adjusted.active_7kW.minimum_supported, false)
  near(r.charger_adjusted.active_7kW.new_power_kW, 7)
})
test('deterministic sweeps conserve the budget and respect all bounds', () => {
  let cases = 0
  for (const pf of [.5, .9, 1]) for (const base of [0, 60, 74.88, 77.88, 80, 90]) for (const count of [0, 1, 5, 80]) {
    const groups = { active_25kW: count, active_50kW: count + 2, active_150kW: 2 * count }
    const r = calculate({ base_load_percent: base, charger_data: groups }, { ...config, power_factor: pf })
    const minimum = 12 * (4 * count + 2)
    const demand = 25 * count + 50 * (count + 2) + 150 * 2 * count
    const budget = Math.max(0, (40000 - 500 * base) * pf)
    near(r.adjusted_ev_load_kW, Math.min(demand, Math.max(minimum, budget)))
    const totalFromDisplayed = Object.entries(r.charger_adjusted).reduce((sum, [key, a]) => sum + a.new_power_kW * groups[key], 0)
    near(totalFromDisplayed, r.adjusted_ev_load_kW, .0051 * (4 * count + 2) + .01)
    for (const [key, a] of Object.entries(r.charger_adjusted)) {
      assert.ok(a.new_power_kW <= a.original_kW)
      assert.ok(groups[key] === 0 ? a.new_power_kW === 0 : a.new_power_kW >= 12)
      if (groups[key]) near(a.reduction_percent + a.new_power_percent, 100)
    }
    if (budget >= minimum && base <= 80) assert.ok(r.adjusted_total_load_kVA <= 40000.01)
    cases++
  }
  assert.equal(cases, 72)
})
