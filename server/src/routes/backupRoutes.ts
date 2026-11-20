import express from 'express';
import { protect, requireSuperadmin } from '../middleware/auth';
import { requireCompany } from '../middleware/companyAccess';
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
    getCompanyExports,
    downloadCompanyExport
} from '../controllers/companyBackupController';

const router = express.Router();

// All backup routes require authentication
router.use(protect);

// Full database backup routes
router.post('/full/create', requireSuperadmin, createBackup);
router.get('/full/list', requireSuperadmin, getBackups);
router.get('/full/download/:filename', requireSuperadmin, downloadBackup);
router.delete('/full/:filename', requireSuperadmin, removeBackup);
router.post('/full/clean', requireSuperadmin, cleanBackups);
router.post('/full/restore', requireSuperadmin, restoreBackup);

// Company-specific backup routes
router.post('/company/:companyId/export', requireCompany('admin'), exportCompany);
router.post('/company/import', importCompany);
router.get('/company/list', getCompanyExports);
router.get('/company/download/:filename', downloadCompanyExport);

export default router;
