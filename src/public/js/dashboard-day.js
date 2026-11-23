// Inspection is local to this tab. Selecting a point never changes the server cursor.
dayView = setupDayView()
function setupDayView() {
  let frames = []
  let pinned = new URLSearchParams(location.search).get('slot') || ''
  let displayedTime = ''
  let historyTime = ''
  let historyVersion = 0
  let currentKey = ''
  let request = 0

  async function refreshHistory(force = false) {
    const time = ui.inspectTime.value
    if (!ui.slotHistory.open || !time || (!force && time === historyTime)) return
    historyTime = time
    const version = ++historyVersion
    ui.slotRuns.textContent = 'กำลังอ่านประวัติ ' + time
    try {
      const response = await fetch('/api/circuit/measurements?' + new URLSearchParams({time}))
      if (!response.ok) throw Error('อ่านประวัติไม่สำเร็จ')
      const runs = await response.json()
      if (version !== historyVersion) return
      ui.slotRuns.replaceChildren()
      if (!runs.length) ui.slotRuns.textContent = 'ยังไม่มีผลวัดที่บันทึกสำหรับ ' + time
      for (const run of runs) {
        const link = document.createElement('a')
        link.href = '/dashboard?' + new URLSearchParams({mode:'matlab', batch:run.id, slot:time})
        const date = new Date(run.created_at).toLocaleString('th-TH')
        link.textContent = date + ' · PF ' + run.config.power_factor + ' · เป้า ' + formatNumber(run.target_kW) +
          ' → วัด ' + formatNumber(run.measured_kW) + ' kW'
        ui.slotRuns.append(link)
      }
    } catch (error) { if (version === historyVersion) ui.slotRuns.textContent = error.message }
  }
  ui.slotHistory.addEventListener('toggle', () => refreshHistory(true))
  socket.on('circuit:updated', () => refreshHistory(true))
  function batchId() { return matlabMode ? matlabPlayback?.id : null }
  function select(time) {
    if (!frames.some(frame => frame.time === time)) return
    pinned = time
    display()
    updateControlAvailability()
  }
  function display() {
    if (!frames.length) return
    const time = pinned || circuitSnapshot?.time || frames[0].time
    const index = Math.max(0, frames.findIndex(frame => frame.time === time))
    const frame = frames[index]
    if (displayedTime !== frame.time) ui.detail.hidden = true
    displayedTime = frame.time
    ui.inspectTime.value = frame.time
    ui.previousSlot.disabled = index === 0
    ui.nextSlot.disabled = index === frames.length - 1
    ui.followSlot.disabled = !pinned
    ui.reviewTitle.textContent = 'รายละเอียดเวลา ' + frame.time
    renderAllocation(frame)
    ui.slotLoad.textContent = formatNumber(frame.adjusted_total_load_percent) + '%'
    const allocation = frame.charger_adjusted.active_50kW
    ui.slotTarget.textContent = allocation?.active ? formatNumber(allocation.new_power_kW) + ' kW' : 'ไม่มีรถชาร์จ'
    const row = matlabMode ? matlabPlayback?.rowAt(frame.time) : null
    ui.slotMeasured.textContent = row?.summary ? formatNumber(row.summary.power_kW) + ' kW' : '—'
    ui.slotDetail.hidden = !row?.summary
    const states = {skipped:'ไม่มีรถชาร์จ',pending:'รอคิว',running:'กำลังคำนวณ',submitting:'กำลังส่งงาน',failed:'ทดลองล้มเหลว',cancelled:'ยกเลิกแล้ว'}
    ui.slotNote.textContent = row?.summary ? 'ผลวัดของชุดนี้ · คลาดเคลื่อน ' + formatNumber(row.summary.error_percent) + '%' :
      row ? states[row.status] || row.status : batchId() ? 'เวลานี้อยู่นอกชุดทดลอง' : 'ยังไม่ได้เลือกผลวงจรสำหรับเวลานี้'
    refreshHistory()
    loadChart.draw()
  }
  function invalidate() {
    request++
    currentKey = ''
    historyTime = ''
    historyVersion++
    displayedTime = ''
    ui.detail.hidden = true
    ui.slotRuns.replaceChildren()
    frames = []
    ui.inspectTime.disabled = ui.previousSlot.disabled = ui.nextSlot.disabled = ui.followSlot.disabled = true
    ui.slotDetail.hidden = true
    ui.inspectTime.replaceChildren()
    for (const id of ['slotLoad','slotTarget','slotMeasured']) ui[id].textContent = '—'
    ui.reviewTitle.textContent = 'รายละเอียดช่วงเวลา'
    ui.daySource.textContent = 'กำลังโหลดข้อมูลรายวัน…'
    resetChart()
  }
  async function load() {
    const id = batchId()
    const {interval_ms, ...config} = simulationOptions()
    const url = id ? '/api/circuit/batches/' + encodeURIComponent(id) + '/day' :
      '/api/simulation/day?' + new URLSearchParams(config)
    if (url === currentKey) return
    invalidate()
    const version = request
    currentKey = url
    try {
      const response = await fetch(url)
      if (!response.ok) throw Error('โหลดภาพรวมรายวันไม่สำเร็จ')
      const day = await response.json()
      if (version !== request) return
      frames = day.frames
      ui.inspectTime.replaceChildren(...frames.map(f => new Option(f.time, f.time)))
      ui.inspectTime.disabled = !frames.length
      if (!frames.some(f => f.time === pinned)) pinned = ''
      resetChart(false)
      frames.forEach(appendChartRow)
      loadChart.update('none')
      ui.chartRange.textContent = frames.length ? frames[0].time + ' – ' + frames.at(-1).time : 'ไม่มีข้อมูล'
      const sources = { saved:'ข้อมูลรายวันที่บันทึกพร้อมชุดทดลอง', current:'ข้อมูลโหลดรายวันจาก Supabase',
        mixed:'ช่วงทดลองจากประวัติ · เวลานอกชุดใช้โหลดปัจจุบันกับค่าตั้งของชุดเดิม', saved_slots:'มีเฉพาะช่วงเวลาที่บันทึกไว้' }
      ui.daySource.textContent = (sources[day.source] || '') + ' · ' + frames.length + ' แถว'
      if (circuitSnapshot) lastIndex = circuitSnapshot.index
      display()
    } catch (error) {
      if (version === request) {currentKey = ''; ui.daySource.textContent = error.message}
    }
  }
  ui.inspectTime.addEventListener('change', () => select(ui.inspectTime.value))
  for (const [button, offset] of [[ui.previousSlot,-1],[ui.nextSlot,1]]) {
    button.addEventListener('click', () => select(frames[ui.inspectTime.selectedIndex + offset]?.time))
  }
  ui.followSlot.addEventListener('click', () => { pinned = ''; display(); updateControlAvailability() })
  ui.slotDetail.addEventListener('click', () => matlabPlayback?.openDetail(ui.inspectTime.value))
  return { load, select, display, invalidate, get ready() { return frames.length > 0 },
    get time() { return ui.inspectTime.value }, get pinned() { return pinned } }
}
