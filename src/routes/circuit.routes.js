import { Router } from 'express'
import { circuitService as service } from '../services/circuit.service.js'
const router = Router()
router.get('/status', async (_req,res) => res.json(await service.status()))
router.post('/experiments', (req,res) => res.status(201).json(service.create(req.body || {})))
router.get('/experiments/:id', async (req,res) => res.json(await service.read(req.params.id)))
router.post('/experiments/:id/run', async (req,res) => res.json(await service.run(req.params.id, req.body || {})))
export default router
