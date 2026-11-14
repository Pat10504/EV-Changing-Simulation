import { Router } from 'express'
import healthRouter from './health.routes.js'
import simulationRouter from './simulation.routes.js'
import uploadRouter from './upload.routes.js'
import circuitRouter from './circuit.routes.js'

const router = Router()

router.use(healthRouter)
router.use('/simulation', simulationRouter)
router.use('/upload', uploadRouter)
router.use('/circuit', circuitRouter)

export default router
