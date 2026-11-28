import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import { Server } from 'socket.io'
import { io as connect } from 'socket.io-client'
import { createWorkerBridge } from '../src/services/circuit-bridge.js'

test('only the authenticated EC2 worker receives requests and Flask status codes reach the queue', async t => {
  const token = randomBytes(32).toString('hex')
  const server = createServer()
  const io = new Server(server)
  const bridge = createWorkerBridge(token)
  bridge.attach(io)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => io.close())
  const url = `http://127.0.0.1:${server.address().port}/matlab-worker`
  const worker = key => {
    const client = connect(url, { auth: { token: key }, transports: ['websocket'], reconnection: false, forceNew: true })
    t.after(() => client.close())
    return client
  }

  await assert.rejects(bridge.request('/status'), { status: 503 })
  const [denied] = await once(worker('wrong'), 'connect_error')
  assert.equal(denied.message, 'Unauthorized')
  const client = worker(token)
  await once(client, 'connect')
  const [duplicate] = await once(worker(token), 'connect_error')
  assert.equal(duplicate.message, 'Worker already connected')
  const seen = []
  client.on('circuit:request', (request, reply) => {
    seen.push(request)
    reply(request.method === 'POST' ? { status: 409, body: { message: 'busy' } }
      : { status: 200, body: { matlab_ready: true } })
  })
  assert.deepEqual(await bridge.request('/status'), { matlab_ready: true })
  await assert.rejects(bridge.request('/jobs', { method: 'POST', body: '{"target_power_kW":12}' }), { status: 409 })
  assert.deepEqual(seen[1], { method: 'POST', path: '/jobs', body: { target_power_kW: 12 } })
  const disconnected = once([...io.of('/matlab-worker').sockets.values()][0], 'disconnect')
  client.close()
  await disconnected
  await assert.rejects(bridge.request('/status'), { status: 503 })
})
