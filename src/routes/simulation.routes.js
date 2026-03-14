import { Router } from 'express'
import { getCSVData } from '../controllers/simulation.controller.js'

const router = Router()

router.get('/csv', getCSVData)

export default router
