import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'

const validId = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
export function createBatchStore(directory = resolve('runtime-data/circuit-batches')) {
  function file(id, suffix = '') {
    if (!validId(id)) throw Object.assign(new Error('รหัสชุดทดลองไม่ถูกต้อง'), { status: 400 })
    // Dedicated extension also avoids restarting an already-running nodemon watcher
    // that has not loaded the new ignore configuration yet. Contents remain JSON.
    return join(directory, `${id}${suffix}.snapshot`)
  }
  function read(path) {
    try { return JSON.parse(readFileSync(path, 'utf8')) }
    catch (e) { if (e.code === 'ENOENT') return null; throw e }
  }
  function write(path, data) {
    mkdirSync(directory, { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 })
    renameSync(temporary, path)
  }
  return {
    read: id => read(file(id)) || read(file(id).replace(/\.snapshot$/, '.json')),
    write: batch => write(file(batch.id), batch),
    readResult: id => read(file(id, '.result')) || read(file(id, '.result').replace(/\.snapshot$/, '.json')),
    writeResult: (id, result) => write(file(id, '.result'), result),
    list() {
      let names
      try { names = readdirSync(directory) } catch (e) { if (e.code === 'ENOENT') return []; throw e }
      const ids = [...new Set(names.map(n => n.replace(/\.(json|snapshot)$/, '')).filter(validId))]
      return ids.map(id => read(file(id)) || read(file(id).replace(/\.snapshot$/, '.json'))).filter(Boolean)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
    },
  }
}
