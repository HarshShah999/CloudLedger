import express from 'express';
import { getTrialBalance, getPnL, getBalanceSheet, getAgeing, getDayBook, getStockSummary } from '../controllers/reportController';
import { protect } from '../middleware/auth';
import { requireCompany } from '../middleware/companyAccess';

const router = express.Router();

router.use(protect, requireCompany('viewer'));

router.get('/trial-balance', getTrialBalance);
router.get('/pnl', getPnL);
router.get('/balance-sheet', getBalanceSheet);
router.get('/ageing', getAgeing);
router.get('/day-book', getDayBook);
router.get('/stock-summary', getStockSummary);

export default router;
