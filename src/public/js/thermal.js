import { atRating, crossing, horizon, simulate, stages } from './thermal-model.js'

import { clockTime, heatRuns, referenceSample } from './thermal-fat.js'

const el = Object.fromEntries([...document.querySelectorAll('[id]')].map(node => [node.id, node]))
const switches = [...document.querySelectorAll('[data-mode]')]
const scenarios = {
  A: ['กฎ 6 °C กับอายุฉนวน', 'จ่าย 50 MVA คงที่ เปรียบเทียบอัตราเสื่อมเมื่ออากาศอุ่นขึ้นอีก 6 °C'],
  B: ['อุณหภูมิที่โรงงานวัด ณ พิกัด', 'เลือกพิกัดเพื่อดูอุณหภูมิน้ำมันระหว่างทดสอบ และเทียบผลสรุปกับเกณฑ์รับประกัน'],
  C: ['ภาระเกินชั่วคราว', 'เลือกภาระเริ่มต้นและภาระหลังเพิ่ม แล้วอ่านเวลาที่จุดร้อนขดลวดถึงแต่ละเกณฑ์'],
  D: ['เครื่องวัดอุณหภูมิขดลวดจำลอง', 'ติดตามสถานะเตือนและปลด เปรียบเทียบกับการลดภาระก่อนถึงเกณฑ์เตือน'],
}
const colors = { hot: '#bc5928', oil: '#28749b', managed: '#087564', limit: '#a23e53', warn: '#947025' }
const ambientByMode = { A:30, B:29.7, C:38, D:38 }
const loads = [55, 60, 65, 70]
const format = (value, digits = 1) => value.toLocaleString('en-US', {minimumFractionDigits:digits, maximumFractionDigits:digits})
const elapsed = value => value === null ? 'ไม่ถึงใน 10 ชม.' : value + ' นาที'
const fat50 = referenceSample(heatRuns[50])
const usesFatStart = () => mode === 'C' && el.initial.value === '50'
const controlsByMode = { C: {load:'65', minute:'45'}, D: {load:'65', minute:'45'} }
let mode = 'B'
let chart, run, baseline, heldLoadRun

function table(headers, rows, selected, columns = el.columns, body = el.rows) {
  const tr = document.createElement('tr')
  for (const header of headers) {
    const th = document.createElement('th')
    th.scope = 'col'; th.textContent = header; tr.append(th)
  }
  columns.replaceChildren(tr)
  body.replaceChildren(...rows.map((row, i) => {
    const line = document.createElement('tr')
    if (i === selected) line.className = 'selected'
    for (const value of row) {
      const cell = document.createElement('td')
      cell.textContent = value; line.append(cell)
    }
    return line
  }))
}

function series(label, data, color, extra = {}) {
  return { label, data, borderColor:color, backgroundColor:color, borderWidth:2, pointRadius:0, ...extra }
}
function draw(type, labels, datasets, xLabel, yLabel) {
  chart?.destroy()
  const timeAxis = type === 'line' ? { type:'linear', min:0, max:horizon } : {}
  chart = new Chart(el.plot, {type, data:{labels,datasets}, options:{
    responsive:true, maintainAspectRatio:false, animation:false,
    interaction:{mode:'index',intersect:false},
    onClick(_event, points) {
      if (!points.length) return
      if (mode === 'B') {
        el.fatSample.value = points[0].index
        inspectFatSample()
      } else if (mode === 'C' || mode === 'D') {
        el.minute.value = points[0].index
        inspectMinute()
      }
    },
    scales:{ x:{...timeAxis,title:{display:true,text:xLabel},ticks:{maxTicksLimit:11,maxRotation:0,stepSize:type === 'line' ? 60 : undefined},grid:{display:false}},
      y:{title:{display:true,text:yLabel},beginAtZero:type === 'bar',grace:'5%'} },
    plugins:{legend:{position:'bottom',labels:{boxWidth:17}},tooltip:{callbacks:{
      title(items) {
        if (mode !== 'B') return items[0]?.label ?? ''
        const test = heatRuns[stages[Number(el.stage.value)].mva]
        return clockTime(test.startHour, items[0].parsed.x) + ' น.'
      },
      label(item) { return item.dataset.label + ' · ' + format(item.parsed.y,2) + (mode === 'B' ? ' K' : '') },
    }}},
  }, plugins:[{
    id:'inspectionMinute',
    afterDatasetsDraw(c) {
      if (mode === 'A') return
      const position = mode === 'B' ? heatRuns[stages[Number(el.stage.value)].mva].samples[Number(el.fatSample.value)][0]
        : Number(el.minute.value)
      const x = c.scales.x.getPixelForValue(position)
      const {ctx,chartArea} = c
      ctx.save(); ctx.strokeStyle = '#42625c'; ctx.setLineDash([3,4])
      ctx.beginPath(); ctx.moveTo(x,chartArea.top); ctx.lineTo(x,chartArea.bottom); ctx.stroke(); ctx.restore()
    },
  }]})
}

function reading(point, context, extraTitle = '', extraValue = '') {
  el.resultContext.textContent = context
  el.temperature.textContent = format(point.hotSpot)
  el.oil.textContent = format(point.topOil) + ' °C'
  el.ageRate.textContent = format(point.rate,2) + ' เท่า'
  el.extraRow.hidden = !extraTitle
  el.extraTitle.textContent = extraTitle
  el.extraValue.textContent = extraValue
}

const iecHotSpotLabel = 'อุณหภูมิจุดร้อนของขดลวด (hot-spot temperature, θₕ)'

function steady(ambient) {
  el.resultTitle.textContent = 'ผลเมื่ออุณหภูมิคงตัว'
  const stage = stages[2]
  const point = atRating(stage,ambient)
  el.chartMeta.textContent = 'สภาวะคงตัว'
  const warmer = atRating(stage,ambient + 6)
  reading(point, 'อากาศ ' + format(ambient) + ' °C · ONAF2', 'อัตราเสื่อมเมื่ออุ่นขึ้น 6 °C', format(warmer.rate,2) + ' เท่า')
  el.chartTitle.textContent = 'อัตราเสื่อมตามอุณหภูมิอากาศ'
  const axis = Array.from(new Set([...Array.from({length:37},(_,i)=>i+15), ambient, +(ambient+6).toFixed(1)])).sort((a,b)=>a-b)
  const line = series('อัตราเสื่อมเทียบกับที่ 98 °C', axis.map(x=>({x,y:atRating(stage,x).rate})), colors.managed,
    {pointRadius:axis.map(a=>a===ambient || a===+(ambient+6).toFixed(1) ? 5 : 0)})
  // Use real distances even when the slider inserts a fractional degree.
  draw('scatter',axis,[{...line,showLine:true}], 'อุณหภูมิอากาศ (°C)','อัตราเสื่อม (เท่า)')
  el.tableTitle.textContent = 'ผลเมื่ออากาศเพิ่มขึ้น 6 °C'
  el.tableMeta.textContent = 'พิกัด 50 MVA'
  table(['อากาศ','น้ำมันส่วนบน',iecHotSpotLabel,'อัตราเสื่อม'],[point,warmer].map((p,i)=>
    [format(ambient+6*i)+' °C',format(p.topOil)+' °C',format(p.hotSpot)+' °C',format(p.rate,3)+' เท่า']),0)

}

function inspectFatSample() {
  const test = heatRuns[stages[Number(el.stage.value)].mva]
  const [hour, ambient, topOil] = test.samples[Number(el.fatSample.value)]
  el.fatRise.textContent = format(topOil - ambient)
  el.fatOil.textContent = format(topOil) + ' °C'
  el.fatAir.textContent = format(ambient) + ' °C'
  el.fatPhase.textContent = hour === test.referenceHour ? 'จุดอ้างอิง FAT · เปลี่ยนจากป้อนกำลังสูญเสียรวมเป็นจ่ายกระแสพิกัด'
    : hour < test.referenceHour ? 'ช่วงป้อนกำลังสูญเสียรวม' : 'สิ้นสุดช่วงจ่ายกระแสพิกัด'
  chart.draw()
}

function factoryTest() {
  const stage = stages[Number(el.stage.value)]
  const test = heatRuns[stage.mva]
  const [refHour, air, oil] = referenceSample(test)
  const times = test.samples.map(([hour]) => clockTime(test.startHour, hour))
  el.fatSample.replaceChildren(...times.map((time, i) => new Option(time + ' น.', i)))
  el.fatSample.value = test.samples.findIndex(([hour]) => hour === refHour)
  el.chartTitle.textContent = 'อุณหภูมิน้ำมันด้านบนที่เพิ่มจากอากาศ'
  el.chartMeta.textContent = 'FAT ' + test.page + ' · ' + test.coolingNote
  const rises = test.samples.map(([x, ambient, topOil]) => ({x, y:topOil - ambient}))
  draw('scatter', [], [
    series('น้ำมันที่วัด', rises, colors.oil, {
      showLine: true, pointRadius: test.samples.map(([hour]) => hour === refHour ? 7 : 3),
      pointStyle: test.samples.map(([hour]) => hour === refHour ? 'rectRot' : 'circle'),
      segment: {borderDash: ctx => ctx.p1.parsed.x - ctx.p0.parsed.x > 1 ? [3,5] : []},
    }),
    series('เกณฑ์รับประกันน้ำมัน', rises.map(({x}) => ({x, y:50})), colors.limit, {showLine:true, borderDash:[6,5]}),
  ], 'เวลาหลังเริ่มทดสอบ (ชั่วโมง)', 'อุณหภูมิที่เพิ่มขึ้น (K)')
  el.tableTitle.textContent = 'ผลที่พิกัด ' + stage.mva + ' MVA · ' + stage.cooling
  el.tableMeta.textContent = 'FAT A2.1 · ◆ จุดอ้างอิงน้ำมัน ' + clockTime(test.startHour, refHour) + ' น.'
  const results = [['น้ำมันด้านบน', oil - air, 50], ['ขดลวดแรงสูงเฉลี่ย', test.hvRise, 55], ['ขดลวดแรงต่ำเฉลี่ย', test.lvRise, 55]]
  table(['จุดวัด','ผล FAT (K)','เกณฑ์รับประกัน (K)','ระยะห่างจากเกณฑ์ (K)'],
    results.map(([label, measured, limit]) => [label, format(measured), format(limit), format(limit - measured)]))
  el.handoffText.textContent = stage.mva === 50
    ? 'ใช้จุดอ้างอิง 08:00 น. · อากาศ ' + format(air) + ' °C · น้ำมัน ' + format(oil) + ' °C · ONAF2'
    : 'วงจรความร้อนใน C ใช้พิกัด 50 MVA · เลือก 50 MVA / ONAF2 เพื่อใช้ผล FAT เป็นจุดตั้งต้น'
  el.toC.hidden = stage.mva !== 50
  inspectFatSample()
}

function transient(ambient, load) {
  const initialMVA = usesFatStart() ? 50 : 37.5
  heldLoadRun = usesFatStart() ? simulate(ambient, initialMVA, null, initialMVA) : null
  baseline = simulate(ambient, load, null, initialMVA)
  const managed = mode === 'D' && el.protection.value === 'on'
  run = managed ? simulate(ambient,load,105) : baseline
  const data = [series('จุดร้อนขดลวด · คงภาระ',baseline.points.map(p=>p.hotSpot),colors.hot)]
  if (managed) data.push(series('จุดร้อนขดลวด · ลดภาระ',run.points.map(p=>p.hotSpot),colors.managed))
  data.push(series('น้ำมันส่วนบน'+(managed?' · ลดภาระ':''),run.points.map(p=>p.topOil),colors.oil))
  if (heldLoadRun) {
    data[0].label = 'จุดร้อน · เพิ่มเป็น ' + load + ' MVA'
    data[1].label = 'น้ำมัน · เพิ่มเป็น ' + load + ' MVA'
    data.push(series('จุดร้อน · คง 50 MVA', heldLoadRun.points.map(p => p.hotSpot), colors.hot, {borderDash:[6,5]}),
      series('น้ำมัน · คง 50 MVA', heldLoadRun.points.map(p => p.topOil), colors.oil, {borderDash:[6,5]}))
  }
  if (mode === 'D') {
    for (const [label,value,color] of [['เตือน',110,colors.warn],['ปลด',120,colors.limit]]) {
      data.push(series(label+' '+value+' °C',run.points.map(()=>value),color,{borderDash:[6,5],borderWidth:1}))
    }
  }
  el.chartTitle.textContent = 'การเปลี่ยนแปลงอุณหภูมิหลังเพิ่มภาระ'
  el.chartMeta.textContent = '0–600 นาที · ONAF2'
  draw('line',run.points.map(p=>p.minute),data,'เวลาหลังเพิ่มภาระ (นาที)','อุณหภูมิ (°C)')
  if (mode === 'C') {
    el.tableTitle.textContent = 'เวลาที่จุดร้อนขดลวดถึงเกณฑ์'
    el.tableMeta.textContent = 'อากาศ '+format(ambient)+' °C'
    const cases = heldLoadRun ? [50, load] : loads
    table(['ภาระหลังเริ่ม','ถึง 98 °C','ถึง 110 °C','ถึง 120 °C'],cases.map(mva=>{
      const points = mva === load ? run.points : mva === 50 ? heldLoadRun.points : simulate(ambient,mva).points
      return [mva+' MVA',...[98,110,120].map(t=>elapsed(crossing(points,t)))]
    }),cases.indexOf(load))
  } else {
    el.tableTitle.textContent = 'เหตุการณ์และการเสื่อมสะสมใน 10 ชั่วโมง'
    el.tableMeta.textContent = 'เกณฑ์เตือน/ปลดสมมติสำหรับการสาธิต'
    const reduced = managed ? run : simulate(ambient,load,105)
    table(['การทดลอง','เริ่มลดภาระ','ถึงเกณฑ์เตือน','ถึงเกณฑ์ปลด','ชม. เสื่อมเทียบเท่า'],
      [baseline,reduced].map((r,i)=>[i?'ลดเหลือ 50 MVA ที่ 105 °C':'คงภาระเดิม',i?elapsed(r.reducedAt):'—',
        elapsed(crossing(r.points,110)),elapsed(crossing(r.points,120)),format(r.points.at(-1).hours,2)]),managed?1:0)
  }
  inspectMinute()
}
function inspectMinute() {
  const minute = Number(el.minute.value)
  const p = run.points[minute]
  el.minuteOut.textContent = minute+' / '+horizon
  el.resultTitle.textContent = mode === 'D' ? 'WTI จำลอง' : 'ผล ณ เวลาที่เลือก'
  const load = run.reducedAt !== null && minute >= run.reducedAt ? 50 : Number(el.load.value)
  const context = 'นาทีที่ '+minute+' · ภาระ'+(minute===0?'เริ่มต้น '+(usesFatStart()?50:37.5):' '+load)+' MVA'
  if (mode === 'D') reading(p, context, 'อายุฉนวนที่ใช้สะสม', format(p.hours,2)+' ชม.')
  else reading(p, context)
  if (heldLoadRun) {
    const held = heldLoadRun.points[minute]
    el.comparisonTime.textContent = 'นาทีที่ ' + minute + ' · ค่าจากแบบจำลอง'
    const metrics = [
      ['น้ำมันด้านบน (°C)', 'topOil', 1], ['จุดร้อนขดลวด (°C)', 'hotSpot', 1],
    ]
    table(['ค่าที่เปรียบเทียบ', 'คง 50 MVA', 'เพิ่มเป็น ' + load + ' MVA', 'ผลต่าง'],
      metrics.map(([label, key, digits]) => [label, format(held[key], digits), format(p[key], digits),
        format(p[key] - held[key], digits)]), undefined, el.comparisonColumns, el.comparisonRows)
  }
  if (mode === 'D') {
    const level = p.hotSpot >= 120 ? 'trip' : p.hotSpot >= 110 ? 'alarm' : 'normal'
    el.signal.dataset.level = level
    el.signal.textContent = {normal:'ต่ำกว่าเกณฑ์เตือน',alarm:'ถึงเกณฑ์เตือน 110 °C',trip:'ถึงเกณฑ์ปลดจำลอง 120 °C'}[level]
    el.needle.style.transform = 'rotate('+(-180 + 180*Math.min(1,Math.max(0,(p.hotSpot-40)/100)))+'deg)'
    const next = [110,120].find(threshold => p.hotSpot < threshold &&
      run.points.slice(minute).some(point => point.hotSpot >= threshold))
    if (next) {
      const reached = run.points.find(point => point.minute >= minute && point.hotSpot >= next)
      el.signal.textContent += ' · อีก ' + (reached.minute - minute) + ' นาทีถึง ' + next + ' °C'
    }
    el.dial.setAttribute('aria-label','WTI '+format(p.hotSpot)+' องศาเซลเซียส')
  }
  chart.draw()
}
function render() {
  const ambient = usesFatStart() ? fat50[1] : Number(el.ambient.value)
  const dynamic = mode === 'C' || mode === 'D'
  el.title.textContent = scenarios[mode][0]; el.description.textContent = scenarios[mode][1]
  el.temperatureLabel.textContent = mode === 'A' ? iecHotSpotLabel : 'จุดร้อนขดลวด'
  el.ambientOut.value = format(ambient)
  el.stageField.hidden = mode !== 'B'; el.loadField.hidden = !dynamic
  el.protectionField.hidden = el.dial.hidden = el.signal.hidden = mode !== 'D'
  const factory = mode === 'B'
  el.initialField.hidden = mode !== 'C'
  el.ambientField.hidden = factory || usesFatStart()
  el.fatResult.hidden = !factory
  el.modelResult.hidden = factory
  el.handoff.hidden = !factory && !usesFatStart()
  el.comparison.hidden = !usesFatStart()
  if (usesFatStart()) {
    el.toC.hidden = true
    el.handoffText.textContent = '50 MVA · ONAF2 · คงอากาศ ' + format(ambient) +
      ' °C และเริ่มที่น้ำมัน ' + format(fat50[2]) + ' °C ตามผล FAT เวลา 08:00 น. จุดร้อนเริ่มต้นประมาณจากแบบจำลองที่พิกัด'
  }
  el.timeline.hidden = !dynamic
  el.iecReference.hidden = mode !== 'A'
  for (const button of switches) button.setAttribute('aria-pressed',String(button.dataset.mode === mode))
  if (dynamic) transient(ambient, Number(el.load.value))
  else if (factory) factoryTest()
  else steady(ambient)
}
function selectMode(next) {
  ambientByMode[mode] = Number(el.ambient.value)
  if (controlsByMode[mode]) controlsByMode[mode] = {load: el.load.value, minute: el.minute.value}
  mode = next
  if (controlsByMode[mode]) {
    el.load.value = controlsByMode[mode].load
    el.minute.value = controlsByMode[mode].minute
  }
  el.ambient.value = ambientByMode[mode]
  render()
}
for (const button of switches) button.addEventListener('click', () => selectMode(button.dataset.mode))
el.toC.addEventListener('click', () => {
  el.initial.value = '50'
  controlsByMode.C = {load:'60', minute:'0'}
  selectMode('C')
  el.initial.focus()
})
el.initial.addEventListener('change', () => {
  el.minute.value = '0'
  render()
})
el.fatSample.addEventListener('change', inspectFatSample)
el.iecReference.addEventListener('click', () => {
  el.iecDialog.showModal()
  el.iecDialog.querySelector('.reference-pages').scrollTo(0, 0)
})
el.ambient.addEventListener('input',render)
for (const input of [el.stage,el.load,el.protection]) input.addEventListener('change',render)
el.minute.addEventListener('input',inspectMinute)
render()
