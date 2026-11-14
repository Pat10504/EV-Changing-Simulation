import { Router } from 'express'
import { pause, reset, start, state, seek } from '../controllers/simulation.controller.js'

const router = Router()

router.get('/state', state)
router.post('/start', start)
router.post('/seek', seek)
router.post('/pause', pause)
router.post('/reset', reset)

export default router
