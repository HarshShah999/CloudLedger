import Joi from 'joi';
import express from 'express';
import { protect } from '../middleware/auth';
import { requireCompany } from '../middleware/companyAccess';
import {
    getGSTR1, downloadGSTR1Json, getGSTR3B, getTdsRegister, uploadGSTR2B, listGSTR2B, reconcileGSTR2B,
} from '../controllers/gstController';
import { TDS_SECTIONS, STATES } from '../utils/gst';
import { validate, uuid } from '../middleware/validate';

const router = express.Router();

router.use(protect);

/** Reference lists for forms */
router.get('/meta', (_req, res) => {
    res.json({ status: 'success', data: { states: STATES.map(([code, name]) => ({ code, name })), tdsSections: TDS_SECTIONS } });
});

router.get('/gstr1/:companyId', requireCompany('viewer'), getGSTR1);
router.get('/gstr1/:companyId/json', requireCompany('viewer'), downloadGSTR1Json);
router.get('/gstr3b/:companyId', requireCompany('viewer'), getGSTR3B);
router.get('/tds/:companyId', requireCompany('viewer'), getTdsRegister);

router.get('/gstr2b/:companyId', requireCompany('viewer'), listGSTR2B);
router.post(
    '/gstr2b/:companyId',
    validate(Joi.object({ companyId: uuid(), period: Joi.string().trim().pattern(/^\d{6}$/).allow('', null), content: Joi.alternatives(Joi.string().max(30_000_000), Joi.object().unknown(true)).required(), fileName: Joi.string().trim().max(255).allow('', null) })),
    requireCompany('accountant'),
    uploadGSTR2B
);
router.get('/gstr2b/:companyId/:period', requireCompany('viewer'), reconcileGSTR2B);

export default router;
