import { getHardwareLatest } from '../services/simulation.service.js'

export function latest(_req, res, next) {
  try {
    res.json(getHardwareLatest())
  } catch (err) {
    next(err)
  }
}
