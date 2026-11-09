const STORAGE_KEYS = {
  transformerMva: 'transformerMva',
  limitPercent: 'limitPercent',
  powerFactor: 'powerFactor',
}

const MAX_CHART_POINTS = 288

const ui = {
  transformerMva: document.getElementById('transformerMva'),
  limitPercent: document.getElementById('limitPercent'),
  powerFactor: document.getElementById('powerFactor'),
  speed: document.getElementById('speed'),
  playButton: document.getElementById('playButton'),
  pauseButton: document.getElementById('pauseButton'),
  resetButton: document.getElementById('resetButton'),
  connectionState: document.getElementById('connectionState'),
  timeSlot: document.getElementById('timeSlot'),
  recordProgress: document.getElementById('recordProgress'),
  totalLoad: document.getElementById('totalLoad'),
  totalPercent: document.getElementById('totalPercent'),
  controlledLoad: document.getElementById('controlledLoad'),
  controlledPercent: document.getElementById('controlledPercent'),
  baseLoad: document.getElementById('baseLoad'),
  basePercent: document.getElementById('basePercent'),
  statusPill: document.getElementById('statusPill'),
  overLimit: document.getElementById('overLimit'),
  pwmValue: document.getElementById('pwmValue'),
  pwmDetail: document.getElementById('pwmDetail'),
  pwmFill: document.getElementById('pwmFill'),
  signalEvent: document.getElementById('signalEvent'),
  evLoad: document.getElementById('evLoad'),
  limitLoad: document.getElementById('limitLoad'),
  preControlLoad: document.getElementById('preControlLoad'),
  postControlLoad: document.getElementById('postControlLoad'),
  reducePerCharger: document.getElementById('reducePerCharger'),
  minChargerPower: document.getElementById('minChargerPower'),
  controlLimit: document.getElementById('controlLimit'),
  chargerRows: document.getElementById('chargerRows'),
}

const loadChart = createLoadChart()
const socket = io()
let isSimulationRunning = false

initDashboard()

function initDashboard() {
  loadSavedSettings()
  bindControlEvents()
  bindSocketEvents()
}

function loadSavedSettings() {
  ui.transformerMva.value = localStorage.getItem(STORAGE_KEYS.transformerMva) || ui.transformerMva.value
  ui.limitPercent.value = localStorage.getItem(STORAGE_KEYS.limitPercent) || ui.limitPercent.value
  ui.powerFactor.value = localStorage.getItem(STORAGE_KEYS.powerFactor) || ui.powerFactor.value
}

function bindControlEvents() {
  ui.playButton.addEventListener('click', startSimulation)
  ui.powerFactor.addEventListener('change', applyRealtimeSettings)
  ui.transformerMva.addEventListener('change', applyRealtimeSettings)
  ui.limitPercent.addEventListener('change', applyRealtimeSettings)
  ui.speed.addEventListener('change', applyRealtimeSettings)
  ui.pauseButton.addEventListener('click', () => {
    isSimulationRunning = false
    sendSimulationCommand('/api/simulation/pause')
  })
  ui.resetButton.addEventListener('click', () => {
    isSimulationRunning = false
    resetChart()
    sendSimulationCommand('/api/simulation/reset')
  })
}

function bindSocketEvents() {
  socket.on('connect', () => setConnectionState('เชื่อมต่อแล้ว'))
  socket.on('disconnect', () => setConnectionState('ขาดการเชื่อมต่อ', 'overload'))
  socket.on('simulation:update', renderSimulationUpdate)
  socket.on('simulation:state', (data) => {
    ui.signalEvent.textContent = data.status
  })
}

function startSimulation() {
  saveSettings()
  isSimulationRunning = true

  sendSimulationCommand('/api/simulation/start', {
    transformer_mva: Number(ui.transformerMva.value),
    limit_percent: Number(ui.limitPercent.value),
    power_factor: Number(ui.powerFactor.value),
    interval_ms: Number(ui.speed.value),
  })
}

function applyRealtimeSettings() {
  saveSettings()

  if (loadChart.data.labels.length > 0) {
    resetChart()
    if (isSimulationRunning) startSimulation()
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.transformerMva, ui.transformerMva.value)
  localStorage.setItem(STORAGE_KEYS.limitPercent, ui.limitPercent.value)
  localStorage.setItem(STORAGE_KEYS.powerFactor, ui.powerFactor.value)
}

async function sendSimulationCommand(url, body = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()

  if (!res.ok) {
    setConnectionState(data.message || 'ส่งคำสั่งไม่สำเร็จ', 'overload')
  }
}

function renderSimulationUpdate(data) {
  renderLoadSummary(data)
  renderPwmSignal(data)
  renderChargerTable(data)
  updateStatus(data.status)
  updateLoadChart(data)
}

function renderLoadSummary(data) {
  ui.timeSlot.textContent = data.time
  ui.recordProgress.textContent = `${data.index + 1} / ${data.totalRecords} records`
  ui.totalLoad.textContent = `${formatWholeNumber(data.total_load_kVA)} kVA`
  ui.totalPercent.textContent = `${data.total_load_percent}% ของพิกัดหม้อแปลง`
  const controlledLoadKva = data.status === 'OVERLOAD'
    ? data.adjusted_total_load_kVA
    : data.total_load_kVA
  const controlledPercent = data.status === 'OVERLOAD'
    ? data.adjusted_total_load_percent
    : data.total_load_percent
  ui.controlledLoad.textContent = `${formatWholeNumber(controlledLoadKva)} kVA`
  ui.controlledPercent.textContent = `${formatNumber(controlledPercent)}% หลังปรับลด`
  ui.baseLoad.textContent = `${formatWholeNumber(data.base_load_kVA)} kVA`
  ui.basePercent.textContent = `${data.base_load_percent}% โหลดพื้นฐาน`
  ui.evLoad.textContent = `${formatNumber(data.ev_load_kW)} kW`
  ui.limitLoad.textContent = `${formatNumber(data.load_limit_kVA)} kVA`
  ui.preControlLoad.textContent = `${formatWholeNumber(data.total_load_kVA)} kVA`
  ui.postControlLoad.textContent = `${formatWholeNumber(controlledLoadKva)} kVA`
  ui.reducePerCharger.textContent = `${formatNumber(data.reduce_per_charger_kW)} kW`
  ui.minChargerPower.textContent = `${formatNumber(data.min_charger_power_kW || 20)} kW`
  ui.controlLimit.textContent = getControlLimitText(data)
  ui.overLimit.textContent = data.control_limited
    ? `ยังเกินหลังลด: ${formatNumber(data.remaining_over_limit_kVA)} kVA`
    : data.status === 'OVERLOAD'
      ? `หลังควบคุมอยู่ใน limit`
      : `โหลดเกินขีดจำกัด: ${formatNumber(data.over_limit_kVA)} kVA`
}

function renderPwmSignal(data) {
  const pwmPercent = (data.pwm / 255) * 100

  ui.pwmValue.textContent = data.pwm
  ui.pwmDetail.textContent = `${data.pwm_voltage.toFixed(2)} V / กำลังจำลอง ${data.pwm_watt_sim_kW.toFixed(2)} kW`
  ui.pwmFill.style.width = `${pwmPercent}%`
  ui.signalEvent.textContent = data.signal?.type || 'simulation:update'
}

function renderChargerTable(data) {
  const chargerRows = Object.entries(data.charger_breakdown || {})

  if (chargerRows.length === 0) {
    ui.chargerRows.innerHTML = '<tr><td colspan="4">ไม่มีข้อมูลตู้ชาร์จ</td></tr>'
    return
  }

  ui.chargerRows.innerHTML = chargerRows.map(([key, charger]) => {
    const adjusted = data.charger_adjusted?.[key]
    const adjustedText = getAdjustedPowerText(adjusted, charger.size_kW)
    const totalUnits = charger.total_units || '-'

    return `
      <tr>
        <td>${charger.size_kW} kW</td>
        <td>${charger.active} / ${totalUnits}</td>
        <td>${formatNumber(charger.load_kW)} kW</td>
        <td>${adjustedText}</td>
      </tr>
    `
  }).join('')
}

function getAdjustedPowerText(adjusted, originalPowerKw) {
  if (!adjusted) return `${originalPowerKw} kW`
  const limitedText = adjusted.minimum_limited ? ' ขั้นต่ำ' : ''
  const redistributedText = adjusted.redistributed_extra_kW > 0 ? ' กระจายเพิ่ม' : ''
  return `${adjusted.new_power_kW} kW (${adjusted.new_power_percent}%)${limitedText}${redistributedText}`
}

function getControlLimitText(data) {
  if (data.control_limited) {
    return `ทุกตู้ถึงขั้นต่ำ ยังเกิน ${formatNumber(data.unmet_reduction_kW)} kW`
  }

  if (data.redistribution_applied) {
    return `โยกไปตู้ใหญ่ ${formatNumber(data.redistribution_extra_kW)} kW`
  }

  return 'ลดได้ตามแผน'
}

function updateLoadChart(data) {
  const labels = loadChart.data.labels
  const baseLoadPercent = loadChart.data.datasets[0].data
  const evLoadPercent = loadChart.data.datasets[1].data
  const limitPercent = loadChart.data.datasets[2].data
  const evPercent = data.transformer_kVA ? (data.ev_load_kVA / data.transformer_kVA) * 100 : 0

  labels.push(data.time)
  baseLoadPercent.push(data.base_load_percent)
  evLoadPercent.push(Number(evPercent.toFixed(2)))
  limitPercent.push(Number(ui.limitPercent.value))

  if (labels.length > MAX_CHART_POINTS) {
    labels.shift()
    baseLoadPercent.shift()
    evLoadPercent.shift()
    limitPercent.shift()
  }

  loadChart.update('none')
}

function resetChart() {
  loadChart.data.labels = []
  loadChart.data.datasets[0].data = []
  loadChart.data.datasets[1].data = []
  loadChart.data.datasets[2].data = []
  loadChart.update('none')
}

function updateStatus(status) {
  ui.statusPill.textContent = status
  ui.statusPill.className = 'status-pill'

  if (status === 'WARNING') ui.statusPill.classList.add('warning')
  if (status === 'OVERLOAD') ui.statusPill.classList.add('overload')
}

function setConnectionState(text, variant = 'normal') {
  ui.connectionState.textContent = text
  ui.connectionState.className = 'status-pill'
  if (variant === 'overload') ui.connectionState.classList.add('overload')
}

function createLoadChart() {
  return new Chart(document.getElementById('loadChart'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'โหลดพื้นฐาน (%)',
          data: [],
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.14)',
          fill: 'origin',
          stack: 'load',
          tension: 0.35,
          cubicInterpolationMode: 'monotone',
          pointRadius: 0,
          pointHitRadius: 8,
        },
        {
          label: 'โหลด EV (%)',
          data: [],
          borderColor: '#dc2626',
          backgroundColor: 'rgba(220, 38, 38, 0.14)',
          fill: '-1',
          stack: 'load',
          tension: 0.35,
          cubicInterpolationMode: 'monotone',
          pointRadius: 0,
          pointHitRadius: 8,
        },
        {
          label: 'ขีดจำกัด (%)',
          data: [],
          borderColor: '#b42318',
          borderDash: [5, 5],
          stack: 'limit',
          pointRadius: 0,
          pointHitRadius: 8,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      normalized: true,
      elements: {
        line: {
          borderWidth: 2,
          capBezierPoints: true,
        },
      },
      plugins: {
        legend: {
          labels: {
            boxWidth: 12,
            color: '#6d766f',
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#6d766f', maxTicksLimit: 8 },
          grid: { color: '#edf0ea' },
        },
        y: {
          min: 0,
          max: 110,
          stacked: true,
          ticks: { color: '#6d766f', callback: (value) => `${value}%` },
          grid: { color: '#edf0ea' },
        },
      },
    },
  })
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US', {
    maximumFractionDigits: 2,
  })
}

function formatWholeNumber(value) {
  return Number(value || 0).toLocaleString('en-US', {
    maximumFractionDigits: 0,
  })
}
