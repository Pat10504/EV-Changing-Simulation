import { readCSV } from '../services/csv.service.js'

export async function getCSVData(req, res, next) {
  try {
    const data = await readCSV()
    res.json({ total: data.length, records: data })
  } catch (err) {
    next(err)
  }
}
