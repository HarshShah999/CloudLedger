import express from 'express';
import { protect } from '../middleware/auth';
import { requireCompany } from '../middleware/companyAccess';
import { getReminderPreview, sendRemindersNow } from '../controllers/reminderController';

const router = express.Router();
router.use(protect);
router.get('/', requireCompany('viewer'), getReminderPreview);
router.post('/send', requireCompany('admin'), sendRemindersNow);
export default router;
