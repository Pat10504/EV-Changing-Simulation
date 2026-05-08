import { CSV_FIELDS } from '../config/constants.js'
import {
  normalizeChargers,
  normalizeLoadPatterns,
  parseCSVBuffer,
} from '../services/csv.service.js'
import {
  clearSimulationData,
  getDatasetSummary,
  isDatabaseConfigured,
  saveSimulationDataset,
} from '../services/db.service.js'
import { clearSimulationCache } from '../services/simulation.service.js'

export async function uploadDataset(req, res, next) {
  try {
    const chargersFile = req.files?.[CSV_FIELDS.chargersFile]?.[0]
    const loadPatternFile = req.files?.[CSV_FIELDS.loadPatternFile]?.[0]

    if (!chargersFile || !loadPatternFile) {
      return res.status(400).json({
        message: 'กรุณาอัปโหลดไฟล์ chargers.csv และ load_pattern.csv ให้ครบ',
      })
    }

    const chargersRows = await parseCSVBuffer(chargersFile.buffer)
    const loadPatternRows = await parseCSVBuffer(loadPatternFile.buffer)
    const chargers = normalizeChargers(chargersRows)
    const loadPatterns = normalizeLoadPatterns(loadPatternRows)

    const saved = await saveSimulationDataset({ chargers, loadPatterns })
    clearSimulationCache()

    res.json({
      message: 'บันทึกชุดข้อมูลลง Supabase แล้ว',
      saved,
      preview: {
        chargers: chargers.slice(0, 5),
        loadPatterns: loadPatterns.slice(0, 5),
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function clearDataset(_req, res, next) {
  try {
    await clearSimulationData()
    clearSimulationCache()
    res.json({ message: 'ล้างข้อมูลจำลองแล้ว' })
  } catch (err) {
    next(err)
  }
}

export async function getUploadStatus(_req, res, next) {
  try {
    if (!isDatabaseConfigured()) {
      return res.json({
        configured: false,
        message: 'ยังไม่ได้ตั้งค่า Supabase',
      })
    }

    const summary = await getDatasetSummary()
    res.json(summary)
  } catch (err) {
    next(err)
  }
}
