import { Request, Response } from 'express';
import * as users from '../services/userService';
import { sendResetToMember } from '../services/passwordResetService';

/* ---------- Own profile ---------- */

export const updateMe = async (req: Request, res: Response) => {
    res.status(200).json({ status: 'success', data: { user: await users.updateProfile(req.user!.id, req.body) } });
};

export const updatePassword = async (req: Request, res: Response) => {
    await users.changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword, req.user!.sessionId);
    res.status(200).json({ status: 'success', message: 'Password updated successfully' });
};

/* ---------- Company members (requireCompany sets req.company) ---------- */

export const listMembers = async (req: Request, res: Response) => {
    res.status(200).json({ status: 'success', data: { users: await users.listMembers(req.company!.id) } });
};

export const addMember = async (req: Request, res: Response) => {
    res.status(201).json({ status: 'success', data: { user: await users.addMember(req.company!.id, req.body) } });
};

export const updateMember = async (req: Request, res: Response) => {
    await users.updateMemberRole(req.company!.id, req.params.userId, req.body.role);
    res.status(200).json({ status: 'success' });
};

export const removeMember = async (req: Request, res: Response) => {
    await users.removeMember(req.company!.id, req.params.userId);
    res.status(204).send();
};

/** POST /companies/:companyId/members/:userId/password-reset — an admin emails a member a reset link. */
export const sendMemberPasswordReset = async (req: Request, res: Response) => {
    const { email } = await sendResetToMember(req.company!.id, req.params.userId, { id: req.user!.id });
    res.json({ status: 'success', message: `A password reset link was emailed to ${email}` });
};
