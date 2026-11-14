import { Router } from 'express'
import { dashboardPage, formulasPage, uploadPage } from '../controllers/page.controller.js'
import { paths } from '../config/paths.js'

const router = Router()

router.get(['/', '/dashboard', '/dashboard.html'], dashboardPage)
router.get(['/upload', '/upload.html'], uploadPage)
router.get(['/formulas', '/formulas.html'], formulasPage)
router.get(['/circuit', '/circuit.html'], (_req,res) => res.sendFile(paths.publicFile('circuit.html')))

export default router
