import { createClient } from '@supabase/supabase-js'
import { TABLES } from '../config/constants.js'
import { config } from '../config/index.js'

const hasSupabaseConfig = Boolean(config.supabaseUrl && config.supabaseKey)

const supabase = hasSupabaseConfig
  ? createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false },
    })
  : null

export function isDatabaseConfigured() {
  return hasSupabaseConfig
}

export async function clearSimulationData() {
  ensureSupabase()

  await runQuery(supabase.from(TABLES.loadPatterns).delete().neq('id', 0))
  await runQuery(supabase.from(TABLES.chargers).delete().neq('id', 0))
}

export async function saveSimulationDataset({ chargers, loadPatterns }) {
  ensureSupabase()
  await clearSimulationData()

  if (chargers.length > 0) {
    await runQuery(supabase.from(TABLES.chargers).insert(chargers))
  }

  if (loadPatterns.length > 0) {
    await runQuery(supabase.from(TABLES.loadPatterns).insert(loadPatterns))
  }

  return {
    chargers: chargers.length,
    loadPatterns: loadPatterns.length,
  }
}

export async function getChargers() {
  ensureSupabase()

  const { data } = await runQuery(
    supabase
      .from(TABLES.chargers)
      .select('charger_kw,total_units')
      .order('charger_kw', { ascending: true })
  )

  return data || []
}

export async function getLoadPatterns() {
  ensureSupabase()

  const { data } = await runQuery(
    supabase
      .from(TABLES.loadPatterns)
      .select('time_slot,base_load_percent,charger_data')
      .order('time_slot', { ascending: true })
  )

  return data || []
}

export async function getDatasetSummary() {
  ensureSupabase()

  const [chargers, loadPatterns] = await Promise.all([
    getChargers(),
    getLoadPatterns(),
  ])

  return {
    configured: true,
    chargerCount: chargers.length,
    loadPatternCount: loadPatterns.length,
    chargers,
    firstTimeSlot: loadPatterns[0]?.time_slot || null,
    lastTimeSlot: loadPatterns.at(-1)?.time_slot || null,
  }
}

async function runQuery(query) {
  const result = await query

  if (result.error) {
    throw new Error(result.error.message)
  }

  return result
}

function ensureSupabase() {
  if (!supabase) {
    throw new Error('ยังไม่ได้ตั้งค่า Supabase กรุณาใส่ SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ในไฟล์ .env')
  }
}
