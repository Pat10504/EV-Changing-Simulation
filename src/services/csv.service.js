import { parse } from 'csv-parse'
import { CSV_FIELDS } from '../config/constants.js'

function parseCSVInput(input) {
  return new Promise((resolve, reject) => {
    parse(input, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      cast: true,
    }, (err, records) => {
      if (err) reject(err)
      else resolve(records)
    })
  })
}

export async function parseCSVBuffer(buffer) {
  return parseCSVInput(buffer.toString('utf8'))
}

export function normalizeChargers(rows) {
  return rows.map((row, index) => {
    const charger_kw = Number(row.charger_kW ?? row.charger_kw ?? row.kw)
    const total_units = Number(row.total_units ?? row.totalUnits ?? row.units)

    if (!Number.isFinite(charger_kw) || charger_kw <= 0) {
      throw new Error(`chargers.csv แถวที่ ${index + 2}: charger_kW ต้องเป็นตัวเลขมากกว่า 0`)
    }

    if (!Number.isInteger(total_units) || total_units < 0) {
      throw new Error(`chargers.csv แถวที่ ${index + 2}: total_units ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป`)
    }

    return { charger_kw, total_units }
  })
}

export function normalizeLoadPatterns(rows) {
  return rows.map((row, index) => {
    const time_slot = row.time ?? row.time_slot
    const base_load_percent = Number(row.base_load_percent)

    if (!/^\d{2}:\d{2}$/.test(String(time_slot))) {
      throw new Error(`load_pattern.csv แถวที่ ${index + 2}: time ต้องอยู่ในรูปแบบ HH:MM`)
    }

    if (!Number.isFinite(base_load_percent) || base_load_percent < 0) {
      throw new Error(`load_pattern.csv แถวที่ ${index + 2}: base_load_percent ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป`)
    }

    const charger_data = {}
    for (const [key, value] of Object.entries(row)) {
      if (key.startsWith(CSV_FIELDS.activePrefix)) {
        charger_data[key] = Number(value || 0)
      }
    }

    return { time_slot, base_load_percent, charger_data }
  })
}
