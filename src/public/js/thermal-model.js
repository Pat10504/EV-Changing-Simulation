import { heatRuns, referenceSample } from './thermal-fat.js'

// PP0827A01 temperature-rise tests and the assumptions of Thermal_Simulation_Scenarios.
// Keep each cooling stage at its own rated load for the steady-state comparison.
export const stages = [
  { mva: 30, cooling: 'ONAN', gradient: 7.90 },
  { mva: 40, cooling: 'ONAF1', gradient: 10.45 },
  { mva: 50, cooling: 'ONAF2', gradient: 13.15 },
].map(stage => {
  const [, ambient, topOil] = referenceSample(heatRuns[stage.mva])
  return { ...stage, oilRise: Number((topOil - ambient).toFixed(1)) }
})
const rated = stages[2]
const lossRatio = 159.2 / 22.5
const hotSpotFactor = 1.3
export const horizon = 600 // minutes, one-minute integration steps

export function ageing(hotSpot) {
  return 2 ** ((hotSpot - 98) / 6)
}

export function atRating(stage, ambient) {
  const topOil = ambient + stage.oilRise
  const hotSpot = topOil + hotSpotFactor * stage.gradient
  return { topOil, hotSpot, rate: ageing(hotSpot) }
}

function targets(k) {
  const oil = rated.oilRise * ((1 + lossRatio * k ** 2) / (1 + lossRatio)) ** 0.8
  const gradient = hotSpotFactor * rated.gradient * k ** 1.3
  return { oil, fast: 2 * gradient, slow: gradient }
}

// IEC difference equations (18)–(23). The initial temperature is in equilibrium
// at the selected initial load. A protective load reduction takes effect on the following step.
export function simulate(ambient, mva, reduceAt = null, initialMVA = 37.5) {
  let { oil, fast, slow } = targets(initialMVA / rated.mva)
  const requested = targets(mva / rated.mva)
  const reduced = targets(1)
  let reducedAt = null
  let hours = 0
  function sample(minute) {
    const hotSpot = ambient + oil + fast - slow
    const rate = ageing(hotSpot)
    if (minute > 0) hours += rate / 60
    if (reduceAt !== null && reducedAt === null && hotSpot >= reduceAt) reducedAt = minute
    return { minute, hotSpot, topOil: ambient + oil, rate, hours }
  }
  const points = [sample(0)]
  for (let minute = 1; minute <= horizon; minute++) {
    const target = reducedAt === null ? requested : reduced
    oil += (target.oil - oil) / (0.673 * 182)
    fast += (target.fast - fast) / (2 * 7)
    slow += (target.slow - slow) / (182 / 2)
    points.push(sample(minute))
  }
  return { points, reducedAt }
}

export function crossing(points, threshold) {
  return points.find(point => point.hotSpot >= threshold)?.minute ?? null
}
