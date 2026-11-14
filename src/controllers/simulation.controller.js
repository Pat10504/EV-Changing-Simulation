import {
  getSimulationState,
  getAvailableTimes,
  pauseSimulation,
  resetSimulation,
  startSimulation,
  seekSimulation,
} from '../services/simulation.service.js'

export async function start(req, res, next) {
  try {
    await startSimulation(req.body || {})
    res.json({ status: 'started' })
  } catch (err) {
    next(err)
  }
}

export async function seek(req, res, next) {
  try {
    const result = await seekSimulation(req.body || {})
    res.json({ status: 'paused', time: result.time })
  } catch (err) {
    next(err)
  }
}

export function pause(_req, res, next) {
  try {
    pauseSimulation()
    res.json({ status: 'paused' })
  } catch (err) {
    next(err)
  }
}

export function reset(_req, res, next) {
  try {
    resetSimulation()
    res.json({ status: 'reset' })
  } catch (err) {
    next(err)
  }
}

export async function state(_req, res, next) {
  try {
    const availableTimes = await getAvailableTimes()
    res.json({ ...getSimulationState(), availableTimes })
  } catch (err) {
    next(err)
  }
}
