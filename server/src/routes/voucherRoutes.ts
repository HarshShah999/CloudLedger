import express from 'express';
import { protect } from '../middleware/auth';
import { requireCompany, requireResource } from '../middleware/companyAccess';
import { validate, createVoucherSchema, updateVoucherSchema } from '../middleware/validate';
import {
    createVoucher, getVouchers, getVoucherTypes, getVoucherById, updateVoucher, deleteVoucher, getNextVoucherNumber,
} from '../controllers/voucherController';

const router = express.Router();
router.use(protect);

router.get('/', requireCompany('viewer'), getVouchers);
router.post('/', validate(createVoucherSchema), requireCompany('accountant'), createVoucher);
router.get('/types', requireCompany('viewer'), getVoucherTypes);
router.get('/next-number', requireCompany('viewer'), getNextVoucherNumber);

router.get('/:id', requireResource('vouchers', 'viewer'), getVoucherById);
router.put('/:id', validate(updateVoucherSchema), requireResource('vouchers', 'accountant'), updateVoucher);
router.delete('/:id', requireResource('vouchers', 'accountant'), deleteVoucher);

export default router;
