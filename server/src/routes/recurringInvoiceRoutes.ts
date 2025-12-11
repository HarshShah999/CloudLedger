import express from 'express';
import { createRecurringInvoice, getRecurringInvoices, deleteRecurringInvoice, updateRecurringInvoice } from '../controllers/recurringInvoiceController';
import { protect } from '../middleware/auth';

const router = express.Router();

router.use(protect);

router.route('/')
    .post(createRecurringInvoice)
    .get(getRecurringInvoices);

router.route('/:id')
    .delete(deleteRecurringInvoice)
    .patch(updateRecurringInvoice);

export default router;
