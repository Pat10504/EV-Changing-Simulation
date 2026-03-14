import { createReadStream } from 'fs'
import { parse } from 'csv-parse'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOCAL_CSV_PATH = join(__dirname, '../../data/ev_charging.csv')
//LOCAL_CSV_PATH = '/Users/patkruadamrong/EESPU/ev-charging-simulation/data/ev_charging.csv'

export async function readCSV() {
  return new Promise((resolve, reject) => {
    const records = []

    createReadStream(LOCAL_CSV_PATH)
      .pipe(parse({
        columns: true,       // แถวแรกเป็น header → แปลงเป็น key ให้เลย
        skip_empty_lines: true,
        trim: true,
        cast: true,
      }))
      .on('data', (row) => records.push(row))
      .on('end', () => {
        //console.log(JSON.stringify(records))
        resolve(records)
      })
      .on('error', (err) => reject(err))
  })
}
