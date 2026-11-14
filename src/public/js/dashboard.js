const STORAGE_KEYS = { transformerMva: 'transformerMva', limitPercent: 'limitPercent', powerFactor: 'powerFactor' }
const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map(element => [element.id, element]))
const loadChart = createLoadChart()
const socket = io()
let isSimulationRunning = false
let lastIndex = -1
let commandPending = false
let lastSettingsKey = null

for (const [key, storageKey] of Object.entries(STORAGE_KEYS)) {
  ui[key].value = localStorage.getItem(storageKey) || ui[key].value
}
ui.playButton.addEventListener('click', startSimulation)
ui.pauseButton.addEventListener('click', () => sendSimulationCommand('/api/simulation/pause'))
ui.resetButton.addEventListener('click', () => sendSimulationCommand('/api/simulation/reset'))
for (const id of ['transformerMva', 'limitPercent', 'powerFactor', 'speed']) {
  ui[id].addEventListener('change', () => {
    if (!validateSettings()) return
    saveSettings()
    if (isSimulationRunning) startSimulation()
    else showMessage('ค่าที่เปลี่ยนจะใช้เมื่อกดเริ่มจำลอง ผลที่แสดงอยู่เป็นผลของการตั้งค่ารอบก่อน', false)
  })
}
socket.on('connect', async () => {
  ui.connectionState.textContent = '● เชื่อมต่อแล้ว'
  ui.connectionState.className = 'connection-label connected'
  try {
    const response = await fetch('/api/simulation/state')
    if (!response.ok) throw new Error('อ่านสถานะการจำลองไม่สำเร็จ')
    const state = await response.json()
    setRunning(state.running)
    if (state.running) {
      ui.transformerMva.value = state.config.transformer_mva
      ui.limitPercent.value = state.config.limit_percent
      ui.powerFactor.value = state.config.power_factor
      ui.speed.value = state.intervalMs
    }
    if (!state.totalRecords) showMessage('ยังไม่มีข้อมูลโหลดพร้อมจำลอง กรุณาตรวจข้อมูลที่หน้าอัปโหลด CSV', false)
  } catch (error) { showMessage(error.message) }
})
socket.on('disconnect', () => {
  ui.connectionState.textContent = '● ขาดการเชื่อมต่อ'
  ui.connectionState.className = 'connection-label disconnected'
  setRunning(false)
})
socket.on('simulation:update', data => {
  setRunning(true)
  renderSimulationUpdate(data)
})
socket.on('simulation:state', state => {
  setRunning(state.status === 'running')
  if (state.status === 'reset') resetDisplay()
})

function validateSettings() {
  for (const id of ['transformerMva', 'limitPercent', 'powerFactor']) {
    if (!ui[id].reportValidity()) return false
  }
  return true
}
function saveSettings() {
  for (const [key, storageKey] of Object.entries(STORAGE_KEYS)) localStorage.setItem(storageKey, ui[key].value)
}
async function startSimulation() {
  if (!validateSettings() || commandPending) return
  saveSettings()
  const settingsKey = JSON.stringify([ui.transformerMva.value, ui.limitPercent.value, ui.powerFactor.value])
  const ok = await sendSimulationCommand('/api/simulation/start', {
    transformer_mva: Number(ui.transformerMva.value), limit_percent: Number(ui.limitPercent.value),
    power_factor: Number(ui.powerFactor.value), interval_ms: Number(ui.speed.value),
  })
  if (ok) {
    if (lastSettingsKey !== settingsKey) resetChart()
    lastSettingsKey = settingsKey
    setRunning(true)
  }
}
async function sendSimulationCommand(url, body = {}) {
  if (commandPending) return false
  commandPending = true
  ui.playButton.disabled = true
  ui.pauseButton.disabled = true
  ui.resetButton.disabled = true
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message || 'ส่งคำสั่งไม่สำเร็จ')
    ui.dashboardMessage.hidden = true
    if (data.status === 'paused' || data.status === 'reset') setRunning(false)
    if (data.status === 'reset') resetDisplay()
    return true
  } catch (error) {
    showMessage(error.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ')
    return false
  } finally {
    commandPending = false
    ui.playButton.disabled = false
    ui.pauseButton.disabled = !isSimulationRunning
    ui.resetButton.disabled = false
  }
}
function setRunning(running) {
  isSimulationRunning = running
  ui.playButton.textContent = running ? 'กำลังจำลอง' : 'เริ่ม / เล่นต่อ'
  ui.pauseButton.disabled = !running || commandPending
}
function showMessage(message, error = true) {
  ui.dashboardMessage.textContent = message
  ui.dashboardMessage.className = `dashboard-message${error ? ' error' : ''}`
  ui.dashboardMessage.hidden = false
}
function renderSimulationUpdate(data) {
  ui.timeSlot.textContent = data.time
  ui.recordProgress.textContent = `แถว ${data.index + 1} / ${data.totalRecords}`
  ui.totalLoad.textContent = `${formatNumber(data.total_load_kVA)} kVA`
  ui.totalPercent.textContent = `${formatNumber(data.total_load_percent)}% ของพิกัดหม้อแปลง`
  ui.controlledLoad.textContent = `${formatNumber(data.adjusted_total_load_kVA)} kVA`
  ui.controlledPercent.textContent = `${formatNumber(data.adjusted_total_load_percent)}% ของพิกัดหม้อแปลง`
  ui.controlledMeter.style.width = `${Math.min(100, Math.max(0, data.adjusted_total_load_percent))}%`
  ui.controlledMeter.className = data.control_limited ? 'overload' : ''
  ui.baseLoad.textContent = `${formatNumber(data.base_load_kVA)} kVA`
  ui.basePercent.textContent = `${formatNumber(data.base_load_percent)}% ของพิกัดหม้อแปลง`
  ui.evBudget.textContent = `${formatNumber(data.ev_budget_kW)} kW`
  ui.limitLoad.textContent = `ขีดจำกัดรวม ${formatNumber(data.load_limit_kVA)} kVA`
  ui.evLoad.textContent = `${formatNumber(data.ev_load_kW)} kW`
  ui.initialReduction.textContent = `${formatNumber(data.initial_reduction_percent)}%`
  ui.initialRemaining.textContent = `${formatNumber(data.initial_remaining_percent)}%`
  ui.redistributedPower.textContent = `${formatNumber(data.redistribution_extra_kW)} kW รวม`
  ui.adjustedEvLoad.textContent = `${formatNumber(data.adjusted_ev_load_kW)} kW`
  ui.statusPill.textContent = { NORMAL: 'ก่อนควบคุม: ปกติ', WARNING: 'ก่อนควบคุม: เฝ้าระวัง', OVERLOAD: 'ก่อนควบคุม: เกินขีดจำกัด' }[data.status]
  ui.statusPill.className = `status-pill ${data.status === 'OVERLOAD' ? 'overload' : data.status === 'WARNING' ? 'warning' : ''}`
  const limited = data.control_limited
  ui.controlOutcome.className = `control-outcome ${limited ? 'limited' : data.status === 'OVERLOAD' ? 'adjusted' : 'normal'}`
  ui.controlTitle.textContent = limited && data.ev_load_kW === 0 ? 'โหลดพื้นฐานเกินขีดจำกัด' : limited ? 'ถึงขั้นต่ำแล้ว แต่ยังเกินขีดจำกัด' : data.status === 'OVERLOAD' ? 'ปรับกำลังแล้ว · โหลดอยู่ในขีดจำกัด' : 'โหลดอยู่ในขีดจำกัด · จ่ายตามพิกัดได้'
  ui.controlDescription.textContent = limited && data.ev_load_kW === 0
    ? `โหลดพื้นฐานเกิน ${formatNumber(data.remaining_over_limit_kVA)} kVA แม้ไม่มี EV กำลังชาร์จ การลดกำลังตู้จึงแก้ส่วนเกินนี้ไม่ได้`
    : limited
    ? `ยังเกิน ${formatNumber(data.remaining_over_limit_kVA)} kVA (ต้องลดเพิ่ม ${formatNumber(data.unmet_reduction_kW)} kW) งบไม่พอภายใต้จำนวน active และโหลดพื้นฐานชุดนี้ ระบบคงขั้นต่ำและรายงานส่วนที่ลดไม่ได้`
    : data.redistribution_applied
      ? `ตรึงตู้ที่ชนขั้นต่ำ แล้วกระจายไปลดตู้ที่ยังลดได้เพิ่ม ${formatNumber(data.redistribution_extra_kW)} kW รวม`
      : data.status === 'OVERLOAD'
        ? `ลดกำลัง ${formatNumber(data.initial_reduction_percent)}% เท่ากันทุกขนาด โดยยังไม่ชนขั้นต่ำ`
        : 'ไม่มีการลดกำลังชาร์จในช่วงเวลานี้'
  ui.allocationNote.textContent = data.below_minimum_rating
    ? 'พบตู้พิกัดต่ำกว่า 12 kW: ระบบไม่จัดสรรเกินพิกัด จึงไม่สามารถใช้ขั้นต่ำ 12 kW กับตู้กลุ่มนี้ได้'
    : '12 kW เป็นขั้นต่ำต่อตู้ active เมื่อชนขั้นต่ำ เปอร์เซ็นต์ที่ลดสุดท้ายของแต่ละขนาดจะต่างกัน'
  renderChargerTable(data)
  updateLoadChart(data)
}
function renderChargerTable(data) {
  const rows = Object.entries(data.charger_breakdown || {}).sort((a, b) => a[1].size_kW - b[1].size_kW)
  const totalActive = rows.reduce((sum, [, c]) => sum + c.active, 0)
  ui.activeCount.textContent = `${totalActive} ตู้กำลังชาร์จ`
  if (!rows.length) { ui.chargerRows.innerHTML = '<tr><td colspan="8" class="empty-state">ไม่มีตู้ชาร์จในช่วงเวลานี้</td></tr>'; return }
  // All interpolated values are numeric calculation outputs or fixed labels.
  ui.chargerRows.innerHTML = rows.map(([key, c]) => {
    const a = data.charger_adjusted[key]
    const active = c.active > 0
    const note = !active ? 'ไม่มีรถชาร์จ' : !a.minimum_supported ? 'พิกัดต่ำกว่า 12 kW' : a.minimum_limited ? 'ถึงขั้นต่ำ 12 kW' : a.redistributed_extra_kW > 0 ? 'รับการลดเพิ่ม' : a.reduction_percent > 0 ? 'ลดตามสัดส่วน' : 'จ่ายตามพิกัด'
    const noteClass = active && (a.minimum_limited || !a.minimum_supported) ? 'floor' : ''
    return `<tr class="${!active ? 'inactive-row' : ''}">
      <th scope="row">${formatNumber(c.size_kW)} <small>kW</small></th>
      <td>${formatNumber(c.active)} <span class="muted">/ ${formatNumber(c.total_units)}</span></td>
      <td>${formatNumber(c.load_kW)}</td>
      <td class="${active && a.proportional_power_kW < a.min_power_kW ? 'below-floor' : ''}">${active ? formatNumber(a.proportional_power_kW) : '—'}</td>
      <td class="final-power">${active ? formatNumber(a.new_power_kW) : '—'}</td>
      <td>${active ? formatNumber(a.reduction_percent) + '%' : '—'}</td>
      <td>${active ? `<div class="remaining-value">${formatNumber(a.new_power_percent)}%<div class="power-meter"><span style="width:${Number(a.new_power_percent)}%"></span></div></div>` : '—'}</td>
      <td><span class="allocation-tag ${noteClass}">${note}</span></td></tr>`
  }).join('')
}
function updateLoadChart(data) {
  if (data.index <= lastIndex) resetChart()
  lastIndex = data.index
  loadChart.data.labels.push(data.time)
  const values = [data.base_load_percent, data.adjusted_ev_load_kVA / data.transformer_kVA * 100, data.total_load_percent, data.load_limit_kVA / data.transformer_kVA * 100]
  loadChart.data.datasets.forEach((dataset, i) => dataset.data.push(values[i]))
  if (loadChart.data.labels.length > 288) {
    loadChart.data.labels.shift()
    loadChart.data.datasets.forEach(dataset => dataset.data.shift())
  }
  loadChart.update('none')
}
function resetChart() {
  lastIndex = -1
  loadChart.data.labels = []
  loadChart.data.datasets.forEach(dataset => { dataset.data = [] })
  loadChart.update('none')
}
function resetDisplay() {
  resetChart()
  for (const id of ['totalLoad','controlledLoad','baseLoad','evBudget','evLoad','initialReduction','initialRemaining','redistributedPower','adjustedEvLoad']) ui[id].textContent = '—'
  ui.timeSlot.textContent = '--:--'
  ui.recordProgress.textContent = 'ยังไม่มีผลคำนวณ'
  for (const id of ['totalPercent','controlledPercent','basePercent']) ui[id].textContent = 'รอข้อมูลการจำลอง'
  ui.limitLoad.textContent = 'คำนวณจากขีดจำกัด − โหลดพื้นฐาน'
  ui.statusPill.textContent = 'รอข้อมูล'
  ui.statusPill.className = 'status-pill neutral'
  ui.controlledMeter.style.width = '0%'
  ui.controlOutcome.className = 'control-outcome waiting'
  ui.controlTitle.textContent = 'พร้อมเริ่มจำลอง'
  ui.controlDescription.textContent = 'กดเริ่มเพื่อจำลองจากแถวแรกของตารางโหลด'
  ui.activeCount.textContent = 'รอข้อมูล active'
  ui.allocationNote.textContent = 'ถ้าผลรอบแรกต่ำกว่า 12 kW จะตรึงที่ขั้นต่ำ แล้วคำนวณสัดส่วนใหม่ให้ตู้กลุ่มที่เหลือ'
  ui.chargerRows.innerHTML = '<tr><td colspan="8" class="empty-state">กดเริ่มจำลองเพื่อดูผลจากข้อมูลโหลด</td></tr>'
}
function createLoadChart() {
  return new Chart(ui.loadChart, {
    type: 'line',
    data: { labels: [], datasets: [
      { label: 'โหลดพื้นฐาน', data: [], borderColor: '#5e87b5', backgroundColor: 'rgba(94,135,181,.20)', fill: 'origin', stack: 'controlled' },
      { label: 'EV หลังควบคุม', data: [], borderColor: '#157b6b', backgroundColor: 'rgba(21,123,107,.23)', fill: '-1', stack: 'controlled' },
      { label: 'รวมก่อนควบคุม', data: [], borderColor: '#707b8a', borderDash: [3,3], fill: false, stack: 'before' },
      { label: 'ขีดจำกัด', data: [], borderColor: '#bd4538', borderDash: [7,5], fill: false, stack: 'limit' },
    ] },
    options: {
      maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      elements: { line: { borderWidth: 2, tension: 0 }, point: { radius: 0, hitRadius: 10 } },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 18, color: '#586779' } }, tooltip: { callbacks: { label: context => `${context.dataset.label}: ${formatNumber(context.raw)}%` } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#657182', maxTicksLimit: 8 } },
        y: { min: 0, suggestedMax: 110, stacked: true, grid: { color: '#edf1f5' }, ticks: { color: '#657182', callback: value => `${value}%` } },
      },
    },
  })
}
function formatNumber(value) { return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }) }
