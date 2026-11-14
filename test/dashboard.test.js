import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { calculate } from '../src/services/calculation.service.js'

function dashboard() {
  const html = fs.readFileSync(new URL('../src/public/dashboard.html', import.meta.url), 'utf8')
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, { id, textContent: '', innerHTML: '', style: {}, value: '', handlers: {}, reportValidity: () => true, addEventListener(event, fn) { this.handlers[event] = fn } }]))
  for (const [id, value] of Object.entries({ transformerMva: '50', limitPercent: '80', powerFactor: '0.9', speed: '400' })) elements[id].value = value
  const events = {}
  let chart
  const context = vm.createContext({
    document: { querySelectorAll: () => Object.values(elements) }, localStorage: { getItem: () => null, setItem() {} },
    io: () => ({ on(name, fn) { events[name] = fn } }),
    Chart: class { constructor(_element, config) { this.data = config.data; chart = this } update() {} },
    fetch: async () => ({ ok: true, json: async () => ({ status: 'reset' }) }),
  })
  vm.runInContext(fs.readFileSync(new URL('../src/public/js/dashboard.js', import.meta.url), 'utf8'), context)
  return { elements, events, get chart() { return chart } }
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
