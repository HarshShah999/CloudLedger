import Joi from 'joi';
import express from 'express';
import { register, login, getMe, refresh, logout, logoutAll } from '../controllers/authController';
import { validate, registerSchema, loginSchema } from '../middleware/validate';
import { protect } from '../middleware/auth';

const router = express.Router();

router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.get('/me', protect, getMe);
// No body: the refresh token comes from its httpOnly cookie (or `refreshToken` for API clients)
router.post('/refresh', validate(Joi.object({ refreshToken: Joi.string().max(200) })), refresh);
router.post('/logout', validate(Joi.object({})), logout);
router.post('/logout-all', validate(Joi.object({})), protect, logoutAll);

export default router;
