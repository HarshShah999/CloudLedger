import express from 'express';
import { protect } from '../middleware/auth';
import { requireCompany } from '../middleware/companyAccess';
import { getExcelTemplate, postExcelImport, postTallyImport } from '../controllers/importController';

const router = express.Router();
router.use(protect);

router.post('/tally', requireCompany('admin'), postTallyImport);
router.get('/excel/:kind/template', getExcelTemplate);
router.post('/excel/:kind', requireCompany('admin'), postExcelImport);

export default router;
