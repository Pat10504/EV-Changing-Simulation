import { Router } from 'express'
import hardwareRouter from './hardware.routes.js'
import healthRouter from './health.routes.js'
import simulationRouter from './simulation.routes.js'
import uploadRouter from './upload.routes.js'

const router = Router()

router.use(healthRouter)
router.use('/hardware', hardwareRouter)
router.use('/simulation', simulationRouter)
router.use('/upload', uploadRouter)

export default router
