import express from 'express';
import { protect } from '../middleware/auth';
import { requireCompany, requireResource } from '../middleware/companyAccess';
import { validate, createPaymentSchema } from '../middleware/validate';
import { createPayment, getPayments, deletePayment } from '../controllers/paymentController';

const router = express.Router();
router.use(protect);

router.get('/', requireCompany('viewer'), getPayments);
router.post('/', validate(createPaymentSchema), requireCompany('accountant'), createPayment);
router.delete('/:id', requireResource('payments', 'accountant'), deletePayment);

export default router;
