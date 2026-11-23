import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { paths } from '../config/paths.js'

const template = readFileSync(new URL('../views/login.html', import.meta.url), 'utf8')
const lifetime = 8 * 60 * 60 * 1000
const cookieName = 'ev_lab_session'
const sessions = new Map()
const pages = new Set(['/', '/dashboard', '/upload', '/thermal', '/formulas', '/circuit', '/circuit/automatic',
  '/dashboard.html', '/upload.html', '/thermal.html', '/formulas.html', '/circuit.html', '/circuit-automatic.html'])

function destination(value) {
  if (typeof value === 'string' && pages.has(value.split('?')[0]) && !/[\\\s#]/.test(value)) return value
  return '/dashboard'
}

function renderLogin(res, next, message = '', status = 200) {
  const escaped = destination(next).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  res.status(status).send(template
    .replace('<!-- login-message -->', message ? '<p role="alert" class="error">' + message + '</p>' : '')
    .replace('<!-- return-path -->', () => escaped))
}

function matches(input, expected) {
  if (typeof input !== 'string') return false
  const digest = value => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(input), digest(expected))
}

function currentSession(req) {
  const token = req.headers.cookie?.match(/(?:^|;\s*)ev_lab_session=([a-f0-9]{64})(?:;|$)/)?.[1]
  const session = sessions.get(token)
  return session && session.until > Date.now() ? session : null
}

export function loginMiddleware(io) {
  const router = Router()
  const options = { httpOnly: true, sameSite: 'strict', path: '/', secure: Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production') }
  const attempts = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 12, skipSuccessfulRequests: true,
    handler: (req, res) => renderLogin(res, req.body?.next, 'Too many sign-in attempts. Try again in 15 minutes.', 429),
  })

  function end(session) {
    if (!session) return
    clearTimeout(session.timer)
    sessions.delete(session.token)
    io.in(session.token).disconnectSockets(true)
  }

  io.use((socket, next) => {
    const session = currentSession(socket.request)
    if (!session) return next(new Error('กรุณาเข้าสู่ระบบ'))
    socket.join(session.token)
    next()
  })

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })
  router.get('/assets/spu-logo.svg', (_req, res) => res.sendFile(paths.publicFile('assets/spu-logo.svg')))
  router.get('/css/login.css', (_req, res) => res.sendFile(paths.publicFile('css/login.css')))
  router.get('/login', (req, res) => {
    if (currentSession(req)) return res.redirect(destination(req.query.next))
    renderLogin(res, req.query.next)
  })
  router.post('/login', attempts, (req, res) => {
    const { APP_USERNAME, APP_PASSWORD } = process.env
    if (!APP_USERNAME || !APP_PASSWORD) return renderLogin(res, req.body?.next, 'Sign-in is unavailable. Please contact the administrator.', 503)
    const userOK = matches(req.body?.username, APP_USERNAME)
    const passOK = matches(req.body?.password, APP_PASSWORD)
    if (!userOK || !passOK) return renderLogin(res, req.body?.next, 'Incorrect username or password.', 401)
    end(currentSession(req))
    const token = randomBytes(32).toString('hex')
    const session = { token, until: Date.now() + lifetime }
    session.timer = setTimeout(() => end(session), lifetime).unref()
    sessions.set(token, session)
    res.cookie(cookieName, token, { ...options, maxAge: lifetime })
    res.redirect(303, destination(req.body.next))
  })
  router.post('/logout', (req, res) => {
    end(currentSession(req))
    res.clearCookie(cookieName, options).redirect(303, '/login')
  })
  router.use((req, res, next) => {
    if (currentSession(req) || (req.method === 'GET' && req.path === '/api/health')) return next()
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return res.status(401).json({ message: 'กรุณาเข้าสู่ระบบ' })
    const target = destination(req.originalUrl)
    res.redirect(target === '/dashboard' || target === '/' ? '/login' : '/login?next=' + encodeURIComponent(target))
  })
  return router
}
