import express from 'express';
import Joi from 'joi';
import { protect } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { updateMe, updatePassword } from '../controllers/userController';

const router = express.Router();
router.use(protect);

router.put(
    '/me',
    validate(Joi.object({ name: Joi.string().trim().max(255), email: Joi.string().email() })),
    updateMe
);
router.put(
    '/me/password',
    validate(Joi.object({ currentPassword: Joi.string().required(), newPassword: Joi.string().min(8).max(128).required() })),
    updatePassword
);

export default router;
