import { Router } from 'express'
import { pause, reset, start, state } from '../controllers/simulation.controller.js'

const router = Router()

router.get('/state', state)
router.post('/start', start)
router.post('/pause', pause)
router.post('/reset', reset)

export default router
