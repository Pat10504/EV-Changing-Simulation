import { Router } from 'express'
import simulationRouter from './simulation.routes.js'

const router = Router()

router.use('/simulation', simulationRouter)

export default router
