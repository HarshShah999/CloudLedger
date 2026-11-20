import Joi from 'joi';
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
import { validate, uuid } from '../middleware/validate';

const router = express.Router();

// All backup routes require authentication
router.use(protect);

// Full database backup routes
router.post('/full/create', validate(Joi.object({})), requireSuperadmin, createBackup);
router.get('/full/list', requireSuperadmin, getBackups);
router.get('/full/download/:filename', requireSuperadmin, downloadBackup);
router.delete('/full/:filename', requireSuperadmin, removeBackup);
router.post('/full/clean', validate(Joi.object({ retentionDays: Joi.number().integer().min(1).max(3650) })), requireSuperadmin, cleanBackups);
router.post(
    '/full/restore',
    validate(Joi.object({ filename: Joi.string().trim().max(255).pattern(/^[\w.-]+$/).required(), confirmPassword: Joi.string().max(128).required() })),
    requireSuperadmin,
    restoreBackup
);

// Company-specific backup routes
router.post('/company/:companyId/export', validate(Joi.object({ companyId: uuid() })), requireCompany('admin'), exportCompany);
router.post('/company/import', validate(Joi.object({ companyData: Joi.object().unknown(true).required() })), importCompany);
router.get('/company/list', getCompanyExports);
router.get('/company/download/:filename', downloadCompanyExport);

export default router;
