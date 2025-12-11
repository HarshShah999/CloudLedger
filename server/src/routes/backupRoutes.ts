import express from 'express';
import { protect } from '../middleware/auth';
import {
    createBackup,
    getBackups,
    downloadBackup,
    removeBackup,
    cleanBackups,
    restoreBackup
} from '../controllers/backupController';
import {
    exportCompany,
    importCompany,
    getCompanyExports
} from '../controllers/companyBackupController';

const router = express.Router();

// All backup routes require authentication
router.use(protect);

// Full database backup routes
router.post('/full/create', createBackup);
router.get('/full/list', getBackups);
router.get('/full/download/:filename', downloadBackup);
router.delete('/full/:filename', removeBackup);
router.post('/full/clean', cleanBackups);
router.post('/full/restore', restoreBackup);

// Company-specific backup routes
router.post('/company/:companyId/export', exportCompany);
router.post('/company/import', importCompany);
router.get('/company/list', getCompanyExports);

export default router;
