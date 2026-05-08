import { Router } from 'express'
import multer from 'multer'
import { CSV_FIELDS, DEFAULT_LIMITS } from '../config/constants.js'
import {
  clearDataset,
  getUploadStatus,
  uploadDataset,
} from '../controllers/upload.controller.js'

const router = Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: DEFAULT_LIMITS.uploadFileSizeBytes,
  },
})

router.get('/status', getUploadStatus)
router.post(
  '/dataset',
  upload.fields([
    { name: CSV_FIELDS.chargersFile, maxCount: 1 },
    { name: CSV_FIELDS.loadPatternFile, maxCount: 1 },
  ]),
  uploadDataset
)
router.delete('/dataset', clearDataset)

export default router
