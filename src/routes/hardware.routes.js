import { Router } from 'express'
import { latest } from '../controllers/hardware.controller.js'

const router = Router()

router.get('/latest', latest)

export default router
