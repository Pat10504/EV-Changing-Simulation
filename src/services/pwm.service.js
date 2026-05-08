const FULL_PWM = 255
const OUTPUT_VOLTAGE = 5
const DEFAULT_SIMULATED_CHARGER_KW = 50

export function calculatePwmSignal({ status, chargerBreakdown, chargerAdjusted }) {
  const pwmSource = pickPwmSource(chargerBreakdown, chargerAdjusted)
  const originalPowerKw = pwmSource?.original_kW ?? DEFAULT_SIMULATED_CHARGER_KW
  const simulatedPowerKw = status === 'OVERLOAD' && pwmSource
    ? pwmSource.new_power_kW
    : originalPowerKw

  const pwm = clampPwm(Math.round((simulatedPowerKw / originalPowerKw) * FULL_PWM))

  return {
    pwm,
    pwm_voltage: round((pwm / FULL_PWM) * OUTPUT_VOLTAGE),
    pwm_watt_sim_kW: round((pwm / FULL_PWM) * originalPowerKw),
    pwm_source_kW: originalPowerKw,
  }
}

function pickPwmSource(breakdown, adjusted) {
  if (adjusted.active_50kW) return adjusted.active_50kW

  const firstAdjusted = Object.values(adjusted)[0]
  if (firstAdjusted) return firstAdjusted

  const firstBreakdown = Object.values(breakdown)[0]
  if (!firstBreakdown) return null

  return {
    original_kW: firstBreakdown.size_kW,
    new_power_kW: firstBreakdown.size_kW,
  }
}

function clampPwm(value) {
  return Math.max(0, Math.min(FULL_PWM, value))
}

function round(value) {
  return Number(Number(value || 0).toFixed(2))
}
