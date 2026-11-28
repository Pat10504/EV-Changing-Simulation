import { createHash, timingSafeEqual } from 'node:crypto'

const unavailable = message => Object.assign(new Error(message), { status: 503 })
const digest = value => createHash('sha256').update(value).digest()

export function localCircuitBridge(bridgeFetch = fetch) {
  return async (path, options = {}) => {
    try {
      const response = await bridgeFetch(`http://127.0.0.1:5050/api/circuit${path}`, {
        ...options, signal: AbortSignal.timeout(5000),
      })
      const body = await response.json()
      if (!response.ok) throw Object.assign(new Error(body.message || 'Python รับงานไม่สำเร็จ'), { status: response.status })
      return body
    } catch (error) {
      if (error.status) throw error
      throw unavailable('ติดต่อ Python ไม่ได้ กรุณาตรวจ web_app.py ที่พอร์ต 5050')
    }
  }
}

export function createWorkerBridge(token) {
  let worker
  return {
    attach(io) {
      const namespace = io.of('/matlab-worker')
      namespace.use((socket, next) => {
        const supplied = socket.handshake.auth?.token
        if (typeof token !== 'string' || token.length < 32 || typeof supplied !== 'string' ||
            !timingSafeEqual(digest(supplied), digest(token))) return next(new Error('Unauthorized'))
        if (worker?.connected) return next(new Error('Worker already connected'))
        next()
      })
      namespace.on('connection', socket => {
        worker = socket
        socket.on('disconnect', () => { if (worker === socket) worker = undefined })
      })
    },
    async request(path, options = {}) {
      if (!worker?.connected) throw unavailable('AWS ยังไม่เชื่อมกับ Railway กรุณาเปิดตัวเชื่อม MATLAB บน EC2')
      let reply
      try {
        reply = await worker.timeout(8000).emitWithAck('circuit:request', {
          path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null,
        })
      } catch {
        throw unavailable('ขาดการตอบกลับจาก AWS ตรวจตัวเชื่อมบน EC2 แล้วกดทำต่อเพื่อตรวจงานเดิม')
      }
      if (!Number.isInteger(reply?.status) || reply.status < 200 || reply.status > 599 ||
          !reply.body || typeof reply.body !== 'object') throw unavailable('AWS ส่งผลตอบกลับไม่สมบูรณ์')
      if (reply.status >= 300) throw Object.assign(new Error(reply.body.message || 'Python บน AWS รับงานไม่สำเร็จ'), { status: reply.status })
      return reply.body
    },
  }
}
