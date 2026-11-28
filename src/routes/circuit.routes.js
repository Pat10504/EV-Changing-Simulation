import { createWorkerBridge } from '../services/circuit-bridge.js'
import { EventEmitter } from 'node:events'
import { Router } from 'express'
import { createCircuitService } from '../services/circuit.service.js'
import { createCircuitBatchService } from '../services/circuit-batch.service.js'
// Construct runtime services only in the application, never as an import side effect
// of the factories used by tests or inspection scripts.
const token = process.env.MATLAB_WORKER_TOKEN
export const workerBridge = token || process.env.RAILWAY_ENVIRONMENT ? createWorkerBridge(token) : null
const bridge = workerBridge?.request
export const batchEvents = new EventEmitter()
const batches = createCircuitBatchService({ bridge, onChange: id => batchEvents.emit('update', id) })
const service = createCircuitService({ bridge, isBatchBusy: () => batches.ownsEngine() })
const router = Router()
router.get('/status', async (_req,res) => res.json(await service.status()))
router.get('/measurements', (req,res) => res.json(batches.measurementsAt(req.query.time)))
router.get('/batches', (_req,res) => res.json(batches.list()))
router.post('/batches', async (req,res) => res.status(201).json(await batches.create(req.body || {})))
router.get('/batches/:id/day', async (req,res) => res.json(await batches.dayOverview(req.params.id)))
router.get('/batches/:id/dashboard', (req,res) => res.json(batches.dashboard(req.params.id)))
router.get('/batches/:id', (req,res) => res.json(batches.read(req.params.id)))
router.post('/batches/:id/action', (req,res) => res.json(batches.action(req.params.id,req.body?.action)))
router.get('/batches/:id/rows/:rowId', (req,res) => res.json(batches.result(req.params.id,req.params.rowId)))
router.get('/batches/:id/export.csv', (req,res) => {
  const csv = batches.csv(req.params.id)
  res.type('text/csv').attachment(`circuit-batch-${req.params.id}.csv`).send(csv)
})
router.post('/experiments', (req,res) => res.status(201).json(service.create(req.body || {})))
router.get('/experiments/:id', async (req,res) => res.json(await service.read(req.params.id)))
router.post('/experiments/:id/run', async (req,res) => res.json(await service.run(req.params.id, req.body || {})))
export default router
