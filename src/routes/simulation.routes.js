import { Router } from 'express'
import { pause, reset, start, state, seek } from '../controllers/simulation.controller.js'

import { dayOverview } from '../services/simulation.service.js'

const router = Router()

router.get('/day', async (req, res) => res.json(await dayOverview(req.query)))
router.get('/state', state)
router.post('/start', start)
router.post('/seek', seek)
router.post('/pause', pause)
router.post('/reset', reset)

export default router
