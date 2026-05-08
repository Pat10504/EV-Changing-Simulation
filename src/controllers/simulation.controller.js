import {
  getSimulationState,
  pauseSimulation,
  resetSimulation,
  startSimulation,
} from '../services/simulation.service.js'

export async function start(req, res, next) {
  try {
    await startSimulation(req.body || {})
    res.json({ status: 'started' })
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

export function state(_req, res, next) {
  try {
    res.json(getSimulationState())
  } catch (err) {
    next(err)
  }
}
