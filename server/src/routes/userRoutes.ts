import express from 'express';
import { getUsers, createUser, updateUser, deleteUser, updatePassword } from '../controllers/userController';
import { protect, restrictTo } from '../middleware/auth';

const router = express.Router();

// All routes require authentication
router.use(protect);

// Get all users (admin only)
router.get('/', restrictTo('admin'), getUsers);

// Create user (admin only)
router.post('/', restrictTo('admin'), createUser);

// Update user (admin or self)
router.put('/:id', updateUser);

// Delete user (admin only)
router.delete('/:id', restrictTo('admin'), deleteUser);

// Update password (self only)
router.put('/me/password', updatePassword);

export default router;
