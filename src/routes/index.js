import { Router } from 'express'
import simulationRouter from './simulation.routes.js'
import uploadRouter from './upload.routes.js'

const router = Router()

router.use('/simulation', simulationRouter)
router.use('/upload', uploadRouter)

export default router
