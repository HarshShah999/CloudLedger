import { Request, Response } from 'express';
import { previewReminders, reminderHistory, runCompanyReminders } from '../services/reminderService';

export const getReminderPreview = async (req: Request, res: Response) => {
    res.json({ status: 'success', data: { due: await previewReminders(req.company!.id), history: await reminderHistory(req.company!.id) } });
};

/** Sends today's reminders right away (normally done by the daily job). */
export const sendRemindersNow = async (req: Request, res: Response) => {
    res.json({ status: 'success', data: await runCompanyReminders(req.company!.id) });
};
