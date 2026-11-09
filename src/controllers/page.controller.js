import { paths } from '../config/paths.js'

export function dashboardPage(_req, res) {
  res.sendFile(paths.publicFile('dashboard.html'))
}

export function uploadPage(_req, res) {
  res.sendFile(paths.publicFile('upload.html'))
}

export function formulasPage(_req, res) {
  res.sendFile(paths.publicFile('formulas.html'))
}
