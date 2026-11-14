import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { calculate } from '../src/services/calculation.service.js'

function dashboard(responses = []) {
  const requests = []
  const html = fs.readFileSync(new URL('../src/public/dashboard.html', import.meta.url), 'utf8')
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, { id, textContent: '', innerHTML: '', style: {}, value: '', handlers: {}, reportValidity: () => true, addEventListener(event, fn) { this.handlers[event] = fn } }]))
  for (const [id, value] of Object.entries({ transformerMva: '50', limitPercent: '80', powerFactor: '0.9', speed: '400' })) elements[id].value = value
  const events = {}
  let chart
  const context = vm.createContext({
    window: { matchMedia: () => ({ matches: false }) },
    document: { querySelectorAll: () => Object.values(elements) }, localStorage: { getItem: () => null, setItem() {} },
    io: () => ({ on(name, fn) { events[name] = fn } }),
    Chart: class { constructor(_element, config) { this.data = config.data; chart = this } update() {} },
    fetch: async (url, options) => { requests.push({url,body:options?.body ? JSON.parse(options.body) : null}); return { ok: true, json: async () => responses.shift() || ({ status: 'reset' }) } },
  })
  vm.runInContext(fs.readFileSync(new URL('../src/public/js/dashboard.js', import.meta.url), 'utf8'), context)
  return { elements, events, requests, get chart() { return chart } }
}
const snapshot = (base, small, large, index = 1) => ({ ...calculate({ time_slot: '18:55', base_load_percent: base, charger_data: { active_50kW: small, active_150kW: large } }), index, totalRecords: 288 })

test('dashboard separates initial, final, reduced and remaining; chart uses controlled EV', () => {
  const ui = dashboard()
  const data = snapshot(74.88, 84, 53)
  ui.events['simulation:update'](data)
  assert.match(ui.elements.controlTitle.textContent, /โหลดอยู่ในขีดจำกัด/)
  assert.match(ui.elements.chargerRows.innerHTML, /9.48/)
  assert.match(ui.elements.chargerRows.innerHTML, /24.45/)
  assert.match(ui.elements.chargerRows.innerHTML, /83.7%/)
  assert.match(ui.elements.chargerRows.innerHTML, /16.3%/)
  assert.equal(ui.elements.evBudget.textContent, '2,304 kW')
  assert.equal(ui.chart.data.datasets[1].data[0], data.adjusted_ev_load_kVA / data.transformer_kVA * 100)
})
test('limited state reports residual; reset clears metrics and chart; inactive shows no allocation', async () => {
  const ui = dashboard()
  ui.events['simulation:update'](snapshot(77.88, 68, 43))
  assert.match(ui.elements.controlTitle.textContent, /ยังเกิน/)
  assert.match(ui.elements.controlDescription.textContent, /420 kVA/)
  assert.match(ui.elements.controlDescription.textContent, /378 kW/)
  await ui.elements.resetButton.handlers.click()
  assert.equal(ui.elements.totalLoad.textContent, '—')
  assert.equal(ui.elements.timeSlot.textContent, '--:--')
  assert.equal(ui.chart.data.labels.length, 0)
  ui.events['simulation:update'](snapshot(35, 4, 0, 0))
  assert.match(ui.elements.chargerRows.innerHTML, /ไม่มีรถชาร์จ/)
  assert.doesNotMatch(ui.elements.chargerRows.innerHTML, /ถึงขั้นต่ำ/)
})

test('base-only overload is not described as chargers hitting their minimum', () => {
  const ui = dashboard()
  ui.events['simulation:update'](snapshot(85, 0, 0))
  assert.equal(ui.elements.controlTitle.textContent, 'โหลดพื้นฐานเกินขีดจำกัด')
  assert.match(ui.elements.controlDescription.textContent, /แม้ไม่มี EV/)
})

const stateResponse = { running: false, config: { transformer_mva: 50, limit_percent: 80, power_factor: .9 }, intervalMs: 400, availableTimes: ['00:00','12:30','18:35','20:55'] }
test('chosen time is sent to start; preview uses seek; pause and resume do not jump back', async () => {
  const ui = dashboard([stateResponse, {status:'started'}, {status:'paused'}, {status:'started'}, {status:'paused'}])
  await ui.events.connect()
  ui.elements.startTime.value = '18:35'
  ui.elements.startTime.handlers.change()
  await ui.elements.playButton.handlers.click()
  assert.equal(ui.requests.at(-1).body.start_time, '18:35')
  ui.events['simulation:update']({ ...snapshot(74.38,80,51,223), time:'18:35', running:true })
  await ui.elements.pauseButton.handlers.click()
  await ui.elements.playButton.handlers.click()
  assert.equal(ui.requests.at(-1).body.start_time, undefined)
  await ui.elements.jump2055.handlers.click()
  assert.equal(ui.requests.at(-1).url, '/api/simulation/seek')
  assert.equal(ui.requests.at(-1).body.start_time, '20:55')
})
test('seek loads chart history plus chosen point and stays paused', () => {
  const ui = dashboard()
  const before = { ...snapshot(35,4,0,0), time:'00:00' }
  const chosen = { ...snapshot(74.38,80,51,223), time:'18:35', chartHistory:[before], running:false }
  ui.events['simulation:update'](chosen)
  assert.equal(ui.elements.playbackState.textContent, 'พักอยู่')
  assert.deepEqual(Array.from(ui.chart.data.labels), ['00:00','18:35'])
  assert.equal(ui.elements.chartRange.textContent, '00:00 – 18:35 · % พิกัด')
})
test('time picker and shortcuts disable when the dataset is empty', async () => {
  const ui = dashboard([{...stateResponse, availableTimes:[]}])
  await ui.events.connect()
  assert.equal(ui.elements.seekButton.disabled, true)
  assert.equal(ui.elements.playButton.disabled, true)
  assert.equal(ui.elements.jump1835.disabled, true)
})
test('reconnecting after a server restart clears results that no longer exist', async () => {
  const ui = dashboard([stateResponse])
  ui.events['simulation:update'](snapshot(74.38,80,51,223))
  await ui.events.connect()
  assert.equal(ui.elements.timeSlot.textContent, '--:--')
  assert.equal(ui.elements.totalLoad.textContent, '—')
  assert.equal(ui.chart.data.labels.length, 0)
})
