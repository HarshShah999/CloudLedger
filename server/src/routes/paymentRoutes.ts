import express from 'express';
import { createPayment, getPayments, deletePayment } from '../controllers/paymentController';
import { protect } from '../middleware/auth';

const router = express.Router();

router.use(protect);

router.route('/')
    .post(createPayment)
    .get(getPayments);

router.route('/:id')
    .delete(deletePayment);

export default router;
