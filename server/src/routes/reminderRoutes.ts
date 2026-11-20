import Joi from 'joi';
import express from 'express';
import { protect } from '../middleware/auth';
import { requireCompany } from '../middleware/companyAccess';
import { getReminderPreview, sendRemindersNow } from '../controllers/reminderController';
import { validate, uuid } from '../middleware/validate';

const router = express.Router();
router.use(protect);
router.get('/', requireCompany('viewer'), getReminderPreview);
router.post('/send', validate(Joi.object({ companyId: uuid() })), requireCompany('admin'), sendRemindersNow);
export default router;
