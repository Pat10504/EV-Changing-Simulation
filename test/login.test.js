import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import express from 'express'
import { Server } from 'socket.io'
import { loginMiddleware } from '../src/middleware/login.js'

test('shared login protects pages and API, preserves the destination and revokes logout sessions', async t => {
  process.env.APP_USERNAME = 'test-account'
  process.env.APP_PASSWORD = randomUUID()
  const app = express()
  const server = createServer(app)
  const io = new Server(server)
  app.use(express.urlencoded({ extended: false }), loginMiddleware(io))
  app.get(['/thermal.html', '/api/upload/status'], (_req, res) => res.sendStatus(200))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => io.close())
  const request = (path, options = {}) => fetch('http://127.0.0.1:' + server.address().port + path, { redirect: 'manual', ...options })
  assert.equal((await request('/thermal.html')).status, 302)
  assert.equal((await request('/api/upload/status')).status, 401)
  const login = password => request('/login', { method: 'POST', body: new URLSearchParams({
    username: process.env.APP_USERNAME, password, next: '/thermal.html',
  }) })
  assert.equal((await login('incorrect')).status, 401)
  const response = await login(process.env.APP_PASSWORD)
  assert.equal(response.status, 303)
  assert.equal(response.headers.get('location'), '/thermal.html')
  const headers = { Cookie: response.headers.get('set-cookie').split(';')[0] }
  assert.equal((await request('/api/upload/status', { headers })).status, 200)
  assert.equal((await request('/logout', { method: 'POST', headers })).status, 303)
  assert.equal((await request('/api/upload/status', { headers })).status, 401)
})
