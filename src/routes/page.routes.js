import { Router } from 'express'
import { dashboardPage, formulasPage, uploadPage } from '../controllers/page.controller.js'

const router = Router()

router.get(['/', '/dashboard', '/dashboard.html'], dashboardPage)
router.get(['/upload', '/upload.html'], uploadPage)
router.get(['/formulas', '/formulas.html'], formulasPage)

export default router
