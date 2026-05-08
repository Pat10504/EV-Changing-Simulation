const STORAGE_KEYS = {
  transformerMva: 'transformerMva',
  limitPercent: 'limitPercent',
}

const ui = {
  form: document.getElementById('uploadForm'),
  chargersFile: document.getElementById('chargersFile'),
  loadPatternFile: document.getElementById('loadPatternFile'),
  chargersFileName: document.getElementById('chargersFileName'),
  loadPatternFileName: document.getElementById('loadPatternFileName'),
  chargersPreview: document.getElementById('chargersPreview'),
  loadPreview: document.getElementById('loadPreview'),
  chargersPreviewCount: document.getElementById('chargersPreviewCount'),
  loadPreviewCount: document.getElementById('loadPreviewCount'),
  message: document.getElementById('uploadMessage'),
  clearButton: document.getElementById('clearButton'),
  transformerMva: document.getElementById('transformerMva'),
  limitPercent: document.getElementById('limitPercent'),
}

initUploadPage()

function initUploadPage() {
  loadSavedSettings()
  bindUploadEvents()
}

function loadSavedSettings() {
  ui.transformerMva.value = localStorage.getItem(STORAGE_KEYS.transformerMva) || ui.transformerMva.value
  ui.limitPercent.value = localStorage.getItem(STORAGE_KEYS.limitPercent) || ui.limitPercent.value
}

function bindUploadEvents() {
  ui.chargersFile.addEventListener('change', () => {
    previewSelectedFile({
      input: ui.chargersFile,
      target: ui.chargersPreview,
      fileNameTarget: ui.chargersFileName,
      countTarget: ui.chargersPreviewCount,
    })
  })

  ui.loadPatternFile.addEventListener('change', () => {
    previewSelectedFile({
      input: ui.loadPatternFile,
      target: ui.loadPreview,
      fileNameTarget: ui.loadPatternFileName,
      countTarget: ui.loadPreviewCount,
    })
  })

  ui.form.addEventListener('submit', uploadDataset)
  ui.clearButton.addEventListener('click', clearDataset)
}

async function uploadDataset(event) {
  event.preventDefault()

  saveSettings()
  setMessage('กำลังบันทึกชุดข้อมูลลง Supabase...')

  try {
    const data = await postDataset()
    setMessage(`บันทึกข้อมูลตู้ชาร์จ ${data.saved.chargers} รายการ และข้อมูลโหลด ${data.saved.loadPatterns} records แล้ว`, 'ok')
  } catch (err) {
    setMessage(err.message, 'error')
  }
}

async function clearDataset() {
  if (!confirm('ต้องการล้างข้อมูลตู้ชาร์จและข้อมูลโหลดทั้งหมดใน Supabase หรือไม่?')) return

  try {
    const res = await fetch('/api/upload/dataset', { method: 'DELETE' })
    const data = await res.json()

    if (!res.ok) throw new Error(data.message || 'ล้างข้อมูลไม่สำเร็จ')
    setMessage(data.message, 'ok')
  } catch (err) {
    setMessage(err.message, 'error')
  }
}

async function postDataset() {
  const body = new FormData()
  body.append('chargers', ui.chargersFile.files[0])
  body.append('loadPattern', ui.loadPatternFile.files[0])

  const res = await fetch('/api/upload/dataset', {
    method: 'POST',
    body,
  })
  const data = await res.json()

  if (!res.ok) throw new Error(data.message || 'อัปโหลดไม่สำเร็จ')
  return data
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.transformerMva, ui.transformerMva.value)
  localStorage.setItem(STORAGE_KEYS.limitPercent, ui.limitPercent.value)
}

async function previewSelectedFile({ input, target, fileNameTarget, countTarget }) {
  const file = input.files[0]
  if (!file) return

  fileNameTarget.textContent = file.name

  const text = await file.text()
  const rows = parsePreviewRows(text)
  const recordCount = Math.max(rows.length - 1, 0)

  target.innerHTML = renderPreviewTable(rows)
  countTarget.textContent = `${recordCount.toLocaleString('en-US')} records`
}

function parsePreviewRows(text) {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(',').map((cell) => cell.trim()))
}

function renderPreviewTable(rows) {
  if (rows.length === 0) return '<div class="message">ไม่มีข้อมูล</div>'

  const [headers, ...bodyRows] = rows

  return `
    <table>
      <thead>
        <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${bodyRows.map((row) => renderPreviewRow(headers, row)).join('')}
      </tbody>
    </table>
  `
}

function renderPreviewRow(headers, row) {
  return `
    <tr>
      ${headers.map((_, index) => `<td>${escapeHtml(row[index] ?? '')}</td>`).join('')}
    </tr>
  `
}

function setMessage(text, type = '') {
  ui.message.className = `message ${type}`
  ui.message.textContent = text
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]))
}
