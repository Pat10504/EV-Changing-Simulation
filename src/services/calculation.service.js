// ค่า default หม้อแปลง (ถ้า frontend ยังไม่ส่งค่ามา)
const DEFAULT_CONFIG = {
  transformer_mva: 50,
  base_load_percent: 65,
  limit_percent: 80,
}

export function calculate(record, config = DEFAULT_CONFIG) {
  const { transformer_mva, base_load_percent, limit_percent } = config

  // --- ค่าหม้อแปลง ---
  const transformer_kW = transformer_mva * 1000
  const base_load_kW = transformer_kW * (base_load_percent / 100)
  const load_limit_kW = transformer_kW * (limit_percent / 100)

  // --- คำนวณ EV load จาก CSV record ---
  // record มีรูปแบบ: { time: '18:00', active_50kW: 200, active_150kW: 45 }
  // วนหา key ที่ขึ้นต้นด้วย active_ แล้วคูณจำนวนตู้กับขนาด
  let ev_load_kW = 0
  const charger_breakdown = {}

  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith('active_')) {
      const size = parseInt(key.replace('active_', '').replace('kW', ''))
      const load = value * size
      ev_load_kW += load
      charger_breakdown[key] = { 
        active: value, 
        size_kW: size, 
        load_kW: load }
    }
  }

  // --- ภาระรวม ---
  const total_load_kW = base_load_kW + ev_load_kW
  const total_load_percent = (total_load_kW / transformer_kW) * 100

  // --- สถานะ ---
  let status = 'NORMAL'
  if (total_load_percent > 80) status = 'OVERLOAD'
  else if (total_load_percent > 70) status = 'WARNING'

  // --- คำนวณเมื่อ Overload ---
  let over_limit_kW = 0
  let reduce_per_charger_kW = 0
  const charger_adjusted = {}

  if (status === 'OVERLOAD') {
    over_limit_kW = total_load_kW - load_limit_kW
    const total_active = Object.values(charger_breakdown).reduce((sum, c) => sum + c.active, 0)
    reduce_per_charger_kW = total_active > 0 ? over_limit_kW / total_active : 0

    for (const [key, c] of Object.entries(charger_breakdown)) {
      const new_power_kW = Math.max(0, c.size_kW - reduce_per_charger_kW)
      charger_adjusted[key] = {
        original_kW: c.size_kW,
        new_power_kW: parseFloat(new_power_kW.toFixed(2)),
        new_power_percent: parseFloat(((new_power_kW / c.size_kW) * 100).toFixed(2)),
      }
    }
  }

  // --- PWM (จำลองตู้ 50kW 1 ตู้) ---
  let pwm = 255
  if (status === 'OVERLOAD' && charger_adjusted['active_50kW']) {
    pwm = Math.round((charger_adjusted['active_50kW'].new_power_kW / 50) * 255)
  }
  pwm = Math.max(0, Math.min(255, pwm))

  return {
    time: record.time,
    transformer_kW,
    base_load_kW,
    load_limit_kW,
    ev_load_kW,
    total_load_kW: parseFloat(total_load_kW.toFixed(2)),
    total_load_percent: parseFloat(total_load_percent.toFixed(2)),
    status,
    over_limit_kW: parseFloat(over_limit_kW.toFixed(2)),
    reduce_per_charger_kW: parseFloat(reduce_per_charger_kW.toFixed(2)),
    charger_breakdown,
    charger_adjusted,
    pwm,
  }
}
