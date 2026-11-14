const el = Object.fromEntries([...document.querySelectorAll('[id]')].map(e => [e.id,e]))
const id = new URLSearchParams(location.search).get('id')
let experiment = null, connection = null, sending = false, drawn = false
const charts = {}
const number = value => Number(value).toLocaleString('en-US',{maximumFractionDigits:2})
function message(text) { el.notice.textContent = text || ''; el.notice.hidden = !text }
async function api(path, options) {
  const response = await fetch(`/api/circuit${path}`, { ...options, signal:AbortSignal.timeout(12000) })
  const body = await response.json()
  if (!response.ok) throw new Error(body.message || 'อ่านข้อมูลไม่สำเร็จ')
  return body
}
function inputs() { return { reference_voltage_V:Number(el.referenceVoltage.value), initial_soc:Number(el.initialSoc.value)/100, duration_s:Number(el.duration.value) } }
function updateCommand() {
  if (!experiment) return
  const { reference_voltage_V:v } = inputs()
  const p = experiment.snapshot.target_power_kW, current = p*1000/v
  el.currentTarget.textContent = Number.isFinite(current) && v > 0 ? `${number(current)} A` : '—'
  el.currentFormula.textContent = `${number(p)} kW × 1,000 ÷ ${number(v)} V${current > 125 ? ' · เกินขอบเขต 125 A' : ''}`
  const state = experiment.status
  el.runButton.disabled = sending || !['ready','connection_error'].includes(state) || !connection?.matlab_ready || connection?.busy || !Number.isFinite(current) || current > 125 || v < 200 || v > 1000
  el.runButton.textContent = state === 'connection_error' ? 'ตรวจและส่งงานเดิมอีกครั้ง →' : 'รัน MATLAB →'
}
function render(item) {
  experiment = item
  el.empty.hidden = true; el.experiment.hidden = false
  const s = item.snapshot
  el.slot.textContent = s.time
  el.target.textContent = `${number(s.target_power_kW)} kW`
  el.remaining.textContent = `เหลือ ${number(s.remaining_percent)}% ของพิกัด`
  el.activeUnits.textContent = `ทดลอง 1 ตู้ · กลุ่มนี้ active ${s.active_units} ตู้`
  el.jobId.textContent = item.id.slice(0,8)
  const locked = !!item.inputs
  if (locked) {
    el.referenceVoltage.value = item.inputs.reference_voltage_V
    el.initialSoc.value = item.inputs.initial_soc * 100
    el.duration.value = item.inputs.duration_s
  }
  for (const key of ['referenceVoltage','initialSoc','duration']) el[key].disabled = locked || sending
  const labels = {ready:'ยังไม่รัน',submitting:'กำลังส่งงาน',running:'กำลังรัน',complete:'รันครบแล้ว',failed:'รันไม่สำเร็จ',connection_error:'รอตรวจการเชื่อมต่อ'}
  el.jobBadge.textContent = labels[item.status] || item.status
  el.jobBadge.className = `job-badge ${item.status}`
  if (item.status === 'running' || item.status === 'submitting') {
    el.resultTitle.textContent = 'MATLAB กำลังจำลองวงจร'
    el.resultDescription.textContent = `งานเวลา ${s.time} · เป้าหมาย ${number(s.target_power_kW)} kW กำลังคำนวณ คุณออกจากหน้านี้แล้วกลับมาที่ URL เดิมได้`
    el.runHelp.textContent = 'ล็อกค่าตั้งของรอบนี้แล้ว · MATLAB รับงานทีละรอบ'
  } else if (item.status === 'failed') {
    el.resultTitle.textContent = 'รอบทดลองนี้ไม่สำเร็จ'
    el.resultDescription.textContent = 'ตรวจข้อความด้านบน แล้วกลับ Dashboard เพื่อเปิดรอบทดลองใหม่'
  } else if (item.status === 'complete' && item.result) {
    const r = item.result, m = r.summary
    el.resultTitle.textContent = m.stable_tail ? 'รันครบ · ช่วงท้ายผ่านเกณฑ์ความนิ่งเบื้องต้น' : 'รันครบ · ช่วงท้ายยังมีการแกว่ง'
    el.resultDescription.textContent = `ผลจริงของเวลา ${s.time} · ใช้กระแสคำสั่ง ${number(r.target_current_A)} A ค่ากำลังจริงขึ้นกับแรงดันและการตอบสนองของวงจร`
    el.measuredPower.textContent = `${number(m.power_kW)} kW`
    el.measuredVoltage.textContent = `${number(m.voltage_V)} V`
    el.measuredCurrent.textContent = `${number(m.current_A)} A`
    el.powerError.textContent = `ต่างจากเป้าหมาย ${m.error_percent >= 0 ? '+' : ''}${number(m.error_percent)}%`
    el.dcBus.textContent = `${number(m.dc_bus_V)} V`
    el.wallTime.textContent = `${number(r.wall_time_s)} s`
    el.chartNote.textContent = `วงจร 0–${r.duration_s} s · ไม่ใช่เวลารายวัน`
    el.summaryNote.textContent = `ค่าเฉลี่ยถ่วงตามเวลา ช่วง ${number(m.window_start_s)}–${number(m.window_end_s)} s จากข้อมูลเต็ม ${number(r.sample_count)} จุด กำลังช่วงนี้ ${number(m.power_min_kW)}–${number(m.power_max_kW)} kW · กราฟย่อเหลือไม่เกิน 1,200 จุด เกณฑ์ความนิ่งเบื้องต้น: ค่าเฉลี่ยสองครึ่งต่างไม่เกิน 2% และช่วงแกว่งไม่เกิน 5% ไม่ใช่การรับรองวงจร`
    el.runHelp.textContent = 'รอบนี้จบแล้ว · กลับ Dashboard เพื่อสร้างรอบใหม่และเปรียบเทียบ'
    if (!drawn) { plotResults(r); drawn = true }
  }
  message(item.message)
  updateCommand()
}
function chart(canvas, unit, datasets) {
  return new Chart(canvas,{type:'line',data:{datasets},options:{responsive:true,maintainAspectRatio:false,animation:false,
    parsing:false,normalized:true,interaction:{mode:'index',intersect:false},
    elements:{point:{radius:0,hitRadius:8},line:{tension:0,borderWidth:2}},
    scales:{x:{type:'linear',min:0,title:{display:true,text:'เวลาภายในวงจร (s)'},grid:{color:'#edf1f3'}},y:{title:{display:true,text:unit},grid:{color:'#edf1f3'}}},
    plugins:{legend:{position:'bottom',labels:{boxWidth:18,font:{family:'system-ui',size:11}}},tooltip:{callbacks:{title:items=>`${items[0]?.parsed.x.toFixed(4)} s`,label:item=>`${item.dataset.label}: ${number(item.parsed.y)} ${unit}`}}}}})
}
function plotResults(r) {
  const data = r.series
  const points = key => data.time_s.map((x,i)=>({x,y:data[key][i]}))
  const target = value => data.time_s.map(x=>({x,y:value}))
  charts.power = chart(el.powerChart,'kW',[
    {label:'กำลังจากวงจร',data:points('power_kW'),borderColor:'#157d73',backgroundColor:'rgba(21,125,115,.1)',fill:'origin'},
    {label:'กำลังเป้าหมาย',data:target(r.target_kW),borderColor:'#dc8c34',borderDash:[6,4]},
  ])
  charts.voltage = chart(el.voltageChart,'V',[{label:'แรงดันแบตเตอรี่',data:points('voltage_V'),borderColor:'#316fbb'}])
  charts.current = chart(el.currentChart,'A',[{label:'กระแสจากวงจร',data:points('current_A'),borderColor:'#785ab7'},
    {label:'กระแสเป้าหมาย',data:target(r.target_current_A),borderColor:'#dc8c34',borderDash:[6,4]}])
}
async function checkConnection() {
  connection = await api('/status')
  el.connection.textContent = connection.matlab_ready ? (connection.busy ? '● MATLAB กำลังทำงาน' : '● MATLAB พร้อมเชื่อมต่อ') : '○ MATLAB ยังไม่พร้อม'
  el.connection.className = `lab-connection${connection.matlab_ready ? ' ready' : ''}`
  if (!connection.matlab_ready && experiment?.status === 'ready') message(connection.message)
  updateCommand()
}
el.referenceVoltage.addEventListener('input',updateCommand)
el.runForm.addEventListener('submit',async event => {
  event.preventDefault()
  if (!experiment || sending || !el.runForm.reportValidity()) return
  sending = true; updateCommand(); message(null)
  try { render(await api(`/experiments/${id}/run`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(inputs())})) }
  catch(error) { message(error.message) }
  finally { sending = false; updateCommand() }
})
async function refresh() {
  try {
    if (id) render(await api(`/experiments/${encodeURIComponent(id)}`))
    else el.empty.hidden = false
    await checkConnection()
  } catch(error) { message(error.message); if (!experiment) el.empty.hidden = false }
  const active = ['running','submitting','connection_error'].includes(experiment?.status)
  if (!experiment || !['complete','failed'].includes(experiment.status)) setTimeout(refresh,active ? 1500 : 5000)
}
refresh()
