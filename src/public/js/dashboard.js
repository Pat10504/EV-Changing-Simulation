const STORAGE_KEYS = { transformerMva: 'transformerMva', limitPercent: 'limitPercent', powerFactor: 'powerFactor' }
const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map(element => [element.id, element]))
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
let chartRows = []
let appendOrigin = null
const loadChart = createLoadChart()
const socket = io()
let isSimulationRunning = false
let lastIndex = -1
let commandPending = false
let timeSelectionPending = false
let availableTimes = []
let updatesSeen = 0
const shortcuts = { jump1230: '12:30', jump1835: '18:35', jump2055: '20:55' }

for (const [key, storageKey] of Object.entries(STORAGE_KEYS)) {
  ui[key].value = localStorage.getItem(storageKey) || ui[key].value
}
ui.playButton.addEventListener('click', startSimulation)
ui.pauseButton.addEventListener('click', () => sendSimulationCommand('/api/simulation/pause'))
ui.resetButton.addEventListener('click', () => sendSimulationCommand('/api/simulation/reset'))
ui.startTime.addEventListener('change', () => { timeSelectionPending = true })
ui.seekButton.addEventListener('click', seekSelectedTime)
for (const [id, time] of Object.entries(shortcuts)) {
  ui[id].addEventListener('click', () => {
    ui.startTime.value = time
    timeSelectionPending = true
    return seekSelectedTime()
  })
}
for (const id of ['transformerMva', 'limitPercent', 'powerFactor', 'speed']) {
  ui[id].addEventListener('change', () => {
    if (!validateSettings()) return
    saveSettings()
    if (isSimulationRunning) startSimulation()
    else showMessage('ค่าที่เปลี่ยนจะใช้เมื่อกดดูช่วงนี้หรือเล่นต่อ ผลที่แสดงอยู่เป็นผลของการตั้งค่ารอบก่อน', false)
  })
}
socket.on('connect', () => {
  ui.connectionState.textContent = '● เชื่อมต่อแล้ว'
  ui.connectionState.className = 'connection-label connected'
  return refreshState()
})
socket.on('disconnect', () => {
  ui.connectionState.textContent = '● ขาดการเชื่อมต่อ'
  ui.connectionState.className = 'connection-label disconnected'
  setRunning(false)
})
socket.on('simulation:update', data => {
  updatesSeen++
  setRunning(data.running ?? true)
  renderSimulationUpdate(data)
})
socket.on('simulation:state', state => {
  updatesSeen++
  setRunning(state.status === 'running')
  if (state.status === 'reset') resetDisplay()
  if (state.status === 'dataset_changed') { resetDisplay(); return refreshState() }
})
async function refreshState() {
  const seen = updatesSeen
  try {
    const response = await fetch('/api/simulation/state')
    if (!response.ok) throw new Error('อ่านสถานะการจำลองไม่สำเร็จ')
    const state = await response.json()
    const selected = ui.startTime.value
    availableTimes = (state.availableTimes || []).filter(time => /^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    ui.startTime.innerHTML = availableTimes.length
      ? availableTimes.map(time => `<option value="${time}">${time}</option>`).join('')
      : '<option value="">ไม่มีข้อมูลเวลา</option>'
    ui.startTime.value = availableTimes.includes(selected) ? selected : availableTimes[0] || ''
    if (seen === updatesSeen) {
      setRunning(state.running)
      if (state.lastResult || state.running) {
        ui.transformerMva.value = state.config.transformer_mva
        ui.limitPercent.value = state.config.limit_percent
        ui.powerFactor.value = state.config.power_factor
        if (['400', '1000', '2000'].includes(String(state.intervalMs))) ui.speed.value = state.intervalMs
        if (state.lastResult) renderSimulationUpdate(state.lastResult)
      } else if (lastIndex >= 0) resetDisplay()
    }
    if (!availableTimes.length) showMessage('ยังไม่มีข้อมูลโหลดพร้อมจำลอง กรุณาตรวจข้อมูลที่หน้าอัปโหลด CSV', false)
    updateControlAvailability()
  } catch (error) { showMessage(error.message) }
}
function validateSettings() {
  for (const id of ['transformerMva', 'limitPercent', 'powerFactor']) {
    if (!ui[id].reportValidity()) return false
  }
  return true
}
function saveSettings() {
  for (const [key, storageKey] of Object.entries(STORAGE_KEYS)) localStorage.setItem(storageKey, ui[key].value)
}
function simulationOptions() {
  return { transformer_mva: Number(ui.transformerMva.value), limit_percent: Number(ui.limitPercent.value),
    power_factor: Number(ui.powerFactor.value), interval_ms: Number(ui.speed.value) }
}
async function startSimulation() {
  if (!validateSettings() || commandPending) return
  saveSettings()
  const body = simulationOptions()
  if ((timeSelectionPending || lastIndex < 0) && ui.startTime.value) body.start_time = ui.startTime.value
  if (await sendSimulationCommand('/api/simulation/start', body)) {
    timeSelectionPending = false
    setRunning(true)
  }
}
async function seekSelectedTime() {
  if (!validateSettings() || commandPending || !ui.startTime.value) return
  saveSettings()
  if (await sendSimulationCommand('/api/simulation/seek', { ...simulationOptions(), start_time: ui.startTime.value })) {
    timeSelectionPending = false
    setRunning(false)
  }
}
async function sendSimulationCommand(url, body = {}) {
  if (commandPending) return false
  commandPending = true
  updateControlAvailability()
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
    updateControlAvailability()
  }
}
function updateControlAvailability() {
  ui.playButton.disabled = commandPending || availableTimes.length === 0
  ui.pauseButton.disabled = !isSimulationRunning || commandPending
  ui.resetButton.disabled = commandPending
  ui.seekButton.disabled = commandPending || availableTimes.length === 0
  ui.startTime.disabled = commandPending || availableTimes.length === 0
  for (const [id, time] of Object.entries(shortcuts)) ui[id].disabled = commandPending || !availableTimes.includes(time)
}
function setRunning(running) {
  isSimulationRunning = running
  ui.playButton.textContent = running ? 'กำลังจำลอง' : 'เริ่ม / เล่นต่อ'
  ui.playbackState.textContent = running ? 'กำลังเล่น' : 'พักอยู่'
  ui.playbackState.className = `playback-state${running ? ' playing' : ''}`
  updateControlAvailability()
}
function showMessage(message, error = true) {
  ui.dashboardMessage.textContent = message
  ui.dashboardMessage.className = `dashboard-message${error ? ' error' : ''}`
  ui.dashboardMessage.hidden = false
}
function renderSimulationUpdate(data) {
  if (!timeSelectionPending && availableTimes.includes(data.time)) ui.startTime.value = data.time
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
function appendChartRow(data) {
  chartRows.push(data)
  loadChart.data.labels.push(data.time)
  const values = [data.base_load_percent, data.adjusted_ev_load_kVA / data.transformer_kVA * 100,
    data.total_load_percent, data.load_limit_kVA / data.transformer_kVA * 100]
  loadChart.data.datasets.forEach((dataset, i) => dataset.data.push(values[i]))
}
function updateLoadChart(data) {
  const history = data.chartHistory
  if (Array.isArray(history)) {
    resetChart(false)
    history.forEach(appendChartRow)
  } else if (data.index <= lastIndex) resetChart(false)
  // A new Chart.js point normally starts at the baseline. Continue from the
  // visible endpoint instead, including the stacked EV and constant limit line.
  const animate = !Array.isArray(history) && !reducedMotion && lastIndex >= 0
  appendOrigin = animate ? {
    index: loadChart.data.labels.length,
    points: loadChart.data.datasets.map((_dataset, i) => {
      const point = loadChart.getDatasetMeta(i).data.at(-1)
      return point ? { x: point.x, y: point.y } : null
    }),
  } : null
  lastIndex = data.index
  appendChartRow(data)
  while (loadChart.data.labels.length > 288) {
    chartRows.shift()
    loadChart.data.labels.shift()
    loadChart.data.datasets.forEach(dataset => dataset.data.shift())
  }
  ui.chartRange.textContent = `${loadChart.data.labels[0]} – ${data.time} · % พิกัด`
  // Bulk history/first points appear immediately; live updates grow from the tail.
  try { loadChart.update(animate ? undefined : 'none') }
  finally { appendOrigin = null }
}
function resetChart(redraw = true) {
  lastIndex = -1
  chartRows = []
  loadChart.data.labels = []
  loadChart.data.datasets.forEach(dataset => { dataset.data = [] })
  if (redraw) loadChart.update('none')
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
  ui.controlDescription.textContent = 'เลือกเวลาแล้วกดดูช่วงนี้ หรือกดเริ่มเพื่อเล่นจากแถวแรก'
  ui.chartRange.textContent = '% ของพิกัดหม้อแปลง'
  ui.startTime.value = availableTimes[0] || ''
  timeSelectionPending = false
  ui.activeCount.textContent = 'รอข้อมูล active'
  ui.allocationNote.textContent = 'ถ้าผลรอบแรกต่ำกว่า 12 kW จะตรึงที่ขั้นต่ำ แล้วคำนวณสัดส่วนใหม่ให้ตู้กลุ่มที่เหลือ'
  ui.chargerRows.innerHTML = '<tr><td colspan="8" class="empty-state">กดเริ่มจำลองเพื่อดูผลจากข้อมูลโหลด</td></tr>'
}
function createLoadChart() {
  const guide = {
    id: 'timeGuide',
    afterDatasetsDraw(chart) {
      const point = chart.tooltip?.getActiveElements()?.[0]?.element
      if (!point) return
      const { ctx, chartArea } = chart
      ctx.save()
      ctx.beginPath()
      ctx.setLineDash([3, 4])
      ctx.strokeStyle = '#64748b'
      ctx.lineWidth = 1
      ctx.moveTo(point.x, chartArea.top)
      ctx.lineTo(point.x, chartArea.bottom)
      ctx.stroke()
      ctx.restore()
    },
  }
  return new Chart(ui.loadChart, {
    type: 'line', plugins: [guide],
    data: { labels: [], datasets: [
      { label: 'โหลดพื้นฐาน', data: [], borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,.20)', fill: 'origin', stack: 'controlled' },
      { label: 'EV หลังควบคุม', data: [], borderColor: '#059669', backgroundColor: 'rgba(5,150,105,.25)', fill: '-1', stack: 'controlled' },
      { label: 'รวมก่อนควบคุม', data: [], borderColor: '#7c3aed', backgroundColor: '#7c3aed', borderDash: [4,3], fill: false, stack: 'before' },
      { label: 'ขีดจำกัด', data: [], borderColor: '#dc2626', backgroundColor: '#dc2626', borderDash: [8,5], fill: false, stack: 'limit', pointRadius: 0, pointHoverRadius: 0 },
    ] },
    options: {
      maintainAspectRatio: false, normalized: true,
      animation: reducedMotion ? false : { duration: 220, easing: 'easeOutQuart' },
      animations: {
        x: { from: context => appendOrigin && appendOrigin.index === context.dataIndex ? appendOrigin.points[context.datasetIndex]?.x : undefined },
        y: { from: context => appendOrigin && appendOrigin.index === context.dataIndex ? appendOrigin.points[context.datasetIndex]?.y : undefined },
      },
      interaction: { mode: 'index', axis: 'x', intersect: false },
      // Straight segments preserve the sampled values without inventing peaks.
      elements: { line: { borderWidth: 2.5, tension: 0 }, point: {
        radius: context => context.dataIndex === context.dataset.data.length - 1 ? 3 : 0,
        hoverRadius: 5, hitRadius: 12, borderWidth: 2, hoverBorderWidth: 2,
      } },
      plugins: {
        legend: { position: 'bottom', onClick() {}, labels: {
          boxWidth: 22, boxHeight: 9, padding: 18, color: '#334155',
          font: { size: 11, family: 'system-ui, sans-serif' },
        } },
        tooltip: {
          backgroundColor: '#ffffff', titleColor: '#0f172a', bodyColor: '#334155', footerColor: '#047857',
          borderColor: '#d7e0eb', borderWidth: 1, cornerRadius: 10, padding: 14,
          titleMarginBottom: 10, bodySpacing: 8, footerMarginTop: 10, boxPadding: 5,
          titleFont: { size: 13, weight: 'bold', family: 'system-ui, sans-serif' },
          bodyFont: { size: 12, family: 'system-ui, sans-serif' },
          footerFont: { size: 12, weight: 'bold', family: 'system-ui, sans-serif' },
          callbacks: {
            title: items => `ค่าบนกราฟเวลา ${items[0]?.label || ''}`,
            label: context => {
              const kva = context.raw / 100 * (chartRows[context.dataIndex]?.transformer_kVA || 0)
              return ` ${context.dataset.label}: ${formatNumber(context.raw)}% · ${formatNumber(kva)} kVA`
            },
            footer: items => {
              const row = chartRows[items[0]?.dataIndex]
              if (!row) return ''
              const total = row.base_load_percent + row.adjusted_ev_load_kVA / row.transformer_kVA * 100
              return `รวมหลังควบคุม: ${formatNumber(total)}%`
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: '#64748b', maxTicksLimit: 8, maxRotation: 0, autoSkip: true } },
        y: { min: 0, suggestedMax: 110, stacked: true, border: { display: false }, grid: { color: '#e8eef5' }, ticks: { color: '#64748b', padding: 10, callback: value => `${value}%` } },
      },
    },
  })
}
function formatNumber(value) { return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }) }
