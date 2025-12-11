import express from 'express';
import { getTrialBalance, getPnL, getBalanceSheet } from '../controllers/reportController';
import { protect } from '../middleware/auth';

const router = express.Router();

router.use(protect);

router.get('/trial-balance', getTrialBalance);
router.get('/pnl', getPnL);
router.get('/balance-sheet', getBalanceSheet);

export default router;
