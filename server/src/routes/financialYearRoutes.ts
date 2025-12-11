import express from 'express';
import {
    getFinancialYears,
    getActiveFinancialYear,
    createFinancialYear,
    activateFinancialYear,
    closeFinancialYear,
    reopenFinancialYear,
    deleteFinancialYear
} from '../controllers/financialYearController';
import { protect, restrictTo } from '../middleware/auth';

const router = express.Router();

// All routes require authentication
router.use(protect);

// Get all financial years for a company
router.get('/', getFinancialYears);

// Get active financial year
router.get('/active', getActiveFinancialYear);

// Create financial year (admin/accountant only)
router.post('/', restrictTo('admin', 'accountant'), createFinancialYear);

// Activate financial year (admin only)
router.put('/:id/activate', restrictTo('admin'), activateFinancialYear);

// Close financial year (admin only)
router.put('/:id/close', restrictTo('admin'), closeFinancialYear);

// Reopen financial year (admin only)
router.put('/:id/reopen', restrictTo('admin'), reopenFinancialYear);

// Delete financial year (admin only)
router.delete('/:id', restrictTo('admin'), deleteFinancialYear);

export default router;
