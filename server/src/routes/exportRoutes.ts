import express from 'express';
import {
    exportTrialBalanceExcel,
    exportPnLExcel,
    exportBalanceSheetExcel
} from '../controllers/exportController';
import { protect } from '../middleware/auth';

const router = express.Router();

router.use(protect);

// Excel exports
router.get('/trial-balance/excel', exportTrialBalanceExcel);
router.get('/pnl/excel', exportPnLExcel);
router.get('/balance-sheet/excel', exportBalanceSheetExcel);

export default router;
