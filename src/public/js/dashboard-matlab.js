matlabPlayback = setupMatlabPlayback()
matlabPlayback.showMode()
dayView.load()

function setupMatlabPlayback() {
  const el = ui
  const query = new URLSearchParams(window.location.search)
  const storageKey = 'dashboardMatlabBatch'
  let batchId = query.get('batch') || (query.has('new') ? null : localStorage.getItem(storageKey))
  let batch = null, busy = false, loading = false, reload = false, selectedFrame = ''
  let comparison = null, signature = '', detailCharts = [], detailRequest = 0
  const number = value => value == null ? '—' : Number(value).toLocaleString('en-US',{maximumFractionDigits:2})
  const labels = {ready:'พร้อมเริ่ม',running:'กำลังรัน',submitting:'กำลังส่ง',pausing:'รอพักหลังจบรอบ',stopping:'รอหยุดหลังจบรอบ',paused:'พักอยู่',complete:'ครบแล้ว',completed_with_errors:'ครบแล้ว · มีรอบล้มเหลว',stopped:'หยุดแล้ว',pending:'รอคิว',skipped:'ไม่มีรถชาร์จ',failed:'ล้มเหลว',cancelled:'ไม่ได้รัน'}
  async function api(path, options) {
    const response = await fetch(`/api/circuit${path}`, {...options,signal:AbortSignal.timeout(15000)})
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || 'โหลดข้อมูลไม่สำเร็จ')
    return data
  }
  const post = body => ({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  function chart(canvas, data, xOptions = {}) {
    return new Chart(canvas,{type:'line',data,options:{responsive:true,maintainAspectRatio:false,animation:false,
      interaction:{mode:'index',intersect:false},elements:{line:{borderWidth:2,tension:0},point:{radius:3}},
      scales:{x:{title:{display:true,text:'เวลาโหลด'},...xOptions},y:{title:{display:true,text:'kW'}}},
      plugins:{legend:{position:'bottom'}}}})
  }
  function controls() {
    const state = batch?.status
    el.newBatchButton.hidden = !matlabMode || !batchId
    el.newBatchButton.disabled = busy
    const locked = busy || Boolean(batchId)
    for (const id of ['startTime','endTime','referenceVoltage','initialSoc','duration','transformerMva','limitPercent','powerFactor']) el[id].disabled = locked
    for (const [id,time] of Object.entries(shortcuts)) el[id].disabled = locked || !availableTimes.includes(time)
    el.playButton.disabled = busy || (batchId ? !['paused','ready'].includes(state) : !availableTimes.length)
    el.playButton.textContent = state === 'paused' ? 'ทำต่อ' : 'เริ่มจำลองพร้อม MATLAB'
    el.pauseButton.disabled = busy || state !== 'running'
    el.resetButton.disabled = busy || !['ready','paused','running','pausing'].includes(state)
  }
  function selectEnd() {
    const index = availableTimes.indexOf(el.startTime.value)
    if (index >= 0) el.endTime.value = availableTimes[Math.min(index + 2, availableTimes.length - 1)]
  }
  function setTimes() {
    const previous = el.endTime.value
    el.endTime.innerHTML = el.startTime.innerHTML
    if (previous >= el.startTime.value && availableTimes.includes(previous)) el.endTime.value = previous
    else selectEnd()
    if (batch) applySettings(batch)
    if (!availableTimes.length && !batchId) showMessage('ยังไม่มีข้อมูลโหลด กรุณาตรวจข้อมูลที่หน้าอัปโหลด CSV')
    controls()
  }
  function applySettings(data) {
    for (const [id,value] of Object.entries({ transformerMva:data.config.transformer_mva, limitPercent:data.config.limit_percent,
      powerFactor:data.config.power_factor, duration:data.inputs.duration_s, referenceVoltage:data.inputs.reference_voltage_V,
      initialSoc:data.inputs.initial_soc * 100, startTime:data.rows[0].time, endTime:data.rows.at(-1).time })) {
      if (['startTime','endTime'].includes(id) && !Array.from(el[id].options).some(o => o.value === value)) el[id].add(new Option(value,value))
      el[id].value = value
    }
  }
  function render(data) {
    batch = data
    if (!matlabMode) return
    el.batch.hidden = false
    applySettings(data)
    const row = data.rows[data.frame.index]
    const key = data.id + '/' + row.id
    if (key !== selectedFrame) {
      selectedFrame = key
      renderSimulationUpdate(data.frame)
    }
    el.playbackState.textContent = labels[data.status] || data.status
    el.playbackState.className = 'playback-state' + (data.status === 'running' ? ' playing' : '')
    const state = data.status === 'running' && !row.summary && row.active_units ? 'กำลังรอผล MATLAB' : labels[row.status]
    el.batchMessage.textContent = [row.time, state, row.active_units ? 'เป้า ' + number(row.target_power_kW) + ' kW' : 'ไม่มีรถชาร์จ',
      row.summary ? 'วัดได้ ' + number(row.summary.power_kW) + ' kW' : '', data.message].filter(Boolean).join(' · ')
    const latest = data.rows.findLast(entry => entry.summary)
    el.latestMeasurement.hidden = !latest
    if (latest) {
      const measured = latest.summary
      el.latestMeasurement.textContent = `ผลวัดล่าสุด ${latest.time} · เป้า ${number(latest.target_power_kW)} kW · วัดได้ ${number(measured.power_kW)} kW · คลาดเคลื่อน ${number(measured.error_percent)}% · ${number(measured.voltage_V)} V · ${number(measured.current_A)} A`
    }
    const complete = data.rows.filter(r => r.summary).length
    el.progressText.textContent = 'ได้ผลวัด ' + complete + ' จาก ' + data.rows.length + ' แถว'
    if (['complete','stopped','completed_with_errors'].includes(data.status) && localStorage.getItem(storageKey) === data.id) localStorage.removeItem(storageKey)
    el.exportCsv.href = `/api/circuit/batches/${data.id}/export.csv`
    const newSignature = JSON.stringify(data.rows.map(r => [r.id,r.status,r.summary,r.message]))
    if (signature !== newSignature) {
      signature = newSignature; el.rows.replaceChildren()
      for (const row of data.rows) {
        const tr = document.createElement('tr'); tr.dataset.state = row.status
        const cell = text => { const td = document.createElement('td'); td.textContent = text; tr.append(td); return td }
        const timeButton = document.createElement('button')
        timeButton.textContent = row.time
        timeButton.addEventListener('click', () => { dayView.select(row.time); el.inspectTime.scrollIntoView({block:'center'}) })
        cell('').append(timeButton)
        cell(number(row.active_units)); cell(`${number(row.target_power_kW)} kW / ${number(row.target_current_A)} A`)
        const m = row.summary
        cell(m ? `${number(m.power_kW)} kW / ${number(m.voltage_V)} V / ${number(m.current_A)} A` : '—')
        cell(m ? `${m.error_percent >= 0 ? '+' : ''}${number(m.error_percent)}%` : '—')
        cell(m ? (m.stable_tail ? 'ผ่านเกณฑ์เบื้องต้น' : 'ยังแกว่ง') : '—').className = m && !m.stable_tail ? 'auto-warning' : ''
        const grid = cell(row.control_status === 'LIMITED' ? `ยังเกิน ${number(row.remaining_over_limit_kVA)} kVA` : 'อยู่ในขีดจำกัด')
        grid.className = row.control_status === 'LIMITED' ? 'auto-warning' : 'auto-good'
        const status = cell(labels[row.status] || row.status)
        if (row.message) { const note = document.createElement('small'); note.textContent = row.message; status.append(note) }
        if (row.status === 'complete') { const button = document.createElement('button'); button.textContent = 'ดูกราฟ'; button.setAttribute('aria-label',`ดูกราฟเวลา ${row.time}`); button.addEventListener('click',()=>showDetail(row.id)); status.append(' ',button) }
        el.rows.append(tr)
      }
      const chartData = {labels:data.rows.map(r=>r.time),datasets:[
        {label:'กำลังเป้าหมาย (kW)',data:data.rows.map(r=>r.target_power_kW),borderColor:'#dc8c34',borderDash:[6,4]},
        {label:'กำลังเฉลี่ยจาก MATLAB (kW)',data:data.rows.map(r=>r.summary?.power_kW ?? null),borderColor:'#157d73',backgroundColor:'#157d73',spanGaps:false},
      ]}
      if (comparison) { comparison.data = chartData; comparison.update() } else {
        comparison = chart(el.comparisonChart,chartData)
        comparison.options.onClick = (_event, points) => {
          const row = batch.rows[points[0]?.index]
          if (row) dayView.select(row.time)
            if (row?.summary) showDetail(row.id)
        }
      }
    }
    controls()
    dayView.load()
    dayView.display()
  }
  async function showDetail(rowId) {
    const request = ++detailRequest
    const selectedTime = batch?.rows.find(row => row.id === rowId)?.time
    dayView.select(selectedTime)
    try {
      const data = await api(`/batches/${batchId}/rows/${rowId}`)
      if (request !== detailRequest || !matlabMode || dayView.time !== selectedTime) return
      el.detail.hidden = false
      const r = data.result, m = r.summary
      el.detailTitle.textContent = `ผลวงจรเวลา ${data.snapshot.time} · เป้าหมาย ${number(r.target_kW)} kW`
      el.detailSummary.textContent = `เฉลี่ยช่วง ${number(m.window_start_s)}–${number(m.window_end_s)} s · กำลัง ${number(m.power_kW)} kW (ช่วงแกว่ง ${number(m.power_min_kW)}–${number(m.power_max_kW)} kW) · DC bus ${number(m.dc_bus_V)} V · ใช้เวลาคำนวณ ${number(r.wall_time_s)} s · ${m.stable_tail ? 'ผ่านเกณฑ์ความนิ่งเบื้องต้น' : 'ช่วงท้ายยังแกว่ง'} ไม่ใช่การรับรองวงจร`
      detailCharts.forEach(c=>c.destroy()); detailCharts=[]
      for (const [canvas,key,unit,target,color] of [[el.detailPower,'power_kW','kW',r.target_kW,'#157d73'],[el.detailCurrent,'current_A','A',r.target_current_A,'#795ab7'],[el.detailVoltage,'voltage_V','V',null,'#316fbb']]) {
        const points = r.series.time_s.map((x,i)=>({x,y:r.series[key][i]}))
        const datasets = [{label:`วัดจากวงจร (${unit})`,data:points,borderColor:color,pointRadius:0}]
        if (target !== null) datasets.push({label:`เป้าหมาย (${unit})`,data:[{x:0,y:target},{x:r.duration_s,y:target}],borderColor:'#dc8c34',borderDash:[6,4],pointRadius:0})
        const c = chart(canvas,{datasets},{type:'linear',title:{display:true,text:'เวลาภายในวงจร (s)'}})
        c.options.scales.y.title.text = unit; c.options.interaction.mode = 'nearest'; c.update(); detailCharts.push(c)
      }
      el.detail.scrollIntoView({behavior:'smooth',block:'start'})
    } catch(e) { showMessage(e.message) }
  }
  async function loadHistory() {
    const list = await api('/batches'); el.history.replaceChildren(); el.history.className = 'auto-history-list'
    if (!list.length) { el.history.textContent = 'ยังไม่มีชุดทดลองที่บันทึกไว้'; return }
    for (const item of list) {
      const a = document.createElement('a'); a.href = `/dashboard?mode=matlab&batch=${item.id}`
      a.textContent = `${item.start_time}–${item.end_time} · ${new Date(item.created_at).toLocaleString('th-TH')} · ${labels[item.status] || item.status} · ${item.completed}/${item.count} ผล · ${item.id.slice(0,8)}`
      el.history.append(a)
    }
  }

  async function refresh() {
    if (!batchId) return
    if (loading) { reload = true; return }
    loading = true
    try {
      do {
        reload = false
        render(await api('/batches/' + encodeURIComponent(batchId) + '/dashboard'))
      } while (reload)
    } catch (error) { showMessage(error.message) }
    finally { loading = false; if (matlabMode) controls() }
  }
  async function action(command) {
    if (busy || !batchId) return
    busy = true; controls()
    try {
      await api('/batches/' + batchId + '/action',post({action:command}))
      el.dashboardMessage.hidden = true
      await refresh()
    } catch (error) { showMessage(error.message) }
    finally { busy = false; controls() }
  }
  async function start() {
    if (batchId) return action('start')
    if (busy || !validateSettings() || !el.initialSoc.reportValidity() || !el.referenceVoltage.reportValidity()) return
    if (el.endTime.value < el.startTime.value) { showMessage('เลือกเวลาสิ้นสุดตั้งแต่เวลาเริ่มต้นขึ้นไป'); return }
    busy = true; controls(); saveSettings()
    try {
      const created = await api('/batches',post({start_time:el.startTime.value,end_time:el.endTime.value,step_minutes:5,
        reference_voltage_V:Number(el.referenceVoltage.value),initial_soc:Number(el.initialSoc.value)/100,
        duration_s:Number(el.duration.value),config:simulationOptions()}))
      batchId = created.id
      localStorage.setItem(storageKey,batchId)
      window.history.replaceState(null,'','/dashboard?mode=matlab&batch=' + batchId)
      await api('/batches/' + batchId + '/action',post({action:'start'}))
      el.dashboardMessage.hidden = true
    } catch (error) { showMessage(error.message) }
    finally { busy = false; await refresh(); controls() }
  }
  let gridStart = '', matlabStart = ''
  function showMode() {
    el.newBatchButton.hidden = !matlabMode || !batchId
    for (const id of ['speedField','seekButton','manualLaunch','timePicker']) el[id].hidden = matlabMode
    for (const id of ['matlabSettings','matlabResults']) el[id].hidden = !matlabMode
    for (const [link, active] of [[el.gridModeLink,!matlabMode],[el.matlabModeLink,matlabMode]]) {
      if (active) link.setAttribute('aria-current','page')
      else link.removeAttribute('aria-current')
    }
    if (matlabMode) {
      el.matlabStartField.append(el.timeLabel, el.startTime)
      el.timeLabel.textContent = 'เริ่มเวลา'
      el.timeHelp.textContent = 'รันหนึ่งตู้ทุกแถวที่มีรถชาร์จ · แต่ละแถวห่างกัน 5 นาที'
      el.pauseButton.textContent = 'พักหลังจบรอบ'
      el.resetButton.textContent = 'หยุดชุดทดลอง'
      if (availableTimes.includes(matlabStart)) el.startTime.value = matlabStart
      if (availableTimes.length || batch) setTimes()
      else controls()
      if (batch) { selectedFrame = ''; render(batch) }
      refresh()
    } else {
      el.timePicker.prepend(el.timeLabel, el.startTime)
      el.timeLabel.textContent = 'เลือกเวลา'
      el.timeHelp.textContent = 'ดูช่วงนี้เพื่อพักการเล่น ณ เวลาที่เลือก'
      el.pauseButton.textContent = 'พัก'
      el.resetButton.textContent = 'รีเซ็ต'
      for (const key of Object.keys(STORAGE_KEYS)) {
        el[key].disabled = false
        el[key].value = localStorage.getItem(STORAGE_KEYS[key]) || el[key].defaultValue
      }
      if (availableTimes.includes(gridStart)) el.startTime.value = gridStart
      setRunning(false)
    }
  }
  async function switchMode(nextMode, event) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (matlabMode === nextMode || busy || commandPending) return
    if (matlabMode) matlabStart = el.startTime.value
    else gridStart = el.startTime.value
    matlabMode = nextMode
    dayView.invalidate()
    resetDisplay()
    el.dashboardMessage.hidden = true
    el.playbackState.textContent = 'พร้อมเริ่ม'
    const url = matlabMode ? '/dashboard?mode=matlab' + (batchId ? '&batch=' + encodeURIComponent(batchId) : '') : '/dashboard'
    window.history.replaceState(null, '', url)
    showMode()
    dayView.load()
    await refreshState()
  }
  el.gridModeLink.addEventListener('click', event => switchMode(false, event))
  el.matlabModeLink.addEventListener('click', event => switchMode(true, event))
  el.startTime.addEventListener('change', () => { if (matlabMode) selectEnd() })
  el.newBatchButton.addEventListener('click', () => {
    window.location.assign('/dashboard?mode=matlab&new=1')
  })
  el.closeDetail.addEventListener('click',()=>{el.detail.hidden=true;detailRequest++})
  el.history.parentElement.addEventListener('toggle',event=>{
    if (event.target.open) loadHistory().catch(error=>showMessage(error.message))
  })
  socket.on('circuit:updated', id => { if (matlabMode && id === batchId) refresh() })
  socket.on('connect', () => { if (matlabMode) refresh() })
  function rowAt(time) { return batch?.rows.find(row => row.time === time) }
  return { start, action, controls, setTimes, selectEnd, showMode, rowAt, get id() { return batchId },
    openDetail(time) { const row = rowAt(time); if (row?.summary) showDetail(row.id) } }
}
