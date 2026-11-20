import Joi from 'joi';
import express from 'express';
import { protect } from '../middleware/auth';
import { requireCompany } from '../middleware/companyAccess';
import { getExcelTemplate, getImportJobStatus, postExcelImport, postTallyImport } from '../controllers/importController';
import { validate, uuid } from '../middleware/validate';

const router = express.Router();
router.use(protect);

const fileSchema = validate(Joi.object({ companyId: uuid().required(), fileBase64: Joi.string().max(120_000_000).required(), commit: Joi.boolean().default(false), background: Joi.boolean().default(false) }));

router.post('/tally', fileSchema, requireCompany('admin'), postTallyImport);
router.get('/jobs/:jobId', getImportJobStatus);
router.get('/excel/:kind/template', getExcelTemplate);
router.post('/excel/:kind', fileSchema, requireCompany('admin'), postExcelImport);

export default router;
