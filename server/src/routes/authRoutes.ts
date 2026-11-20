import express from 'express';
import { register, login, getMe, refresh, logout, logoutAll } from '../controllers/authController';
import { validate, registerSchema, loginSchema } from '../middleware/validate';
import { protect } from '../middleware/auth';

const router = express.Router();

router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.get('/me', protect, getMe);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.post('/logout-all', protect, logoutAll);

export default router;
