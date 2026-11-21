import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import api, { apiError } from '../../api/axios';

/** Step 1 of resetting a password: ask for the account's email and send a link. */
export const ForgotPassword: React.FC = () => {
    const [email, setEmail] = useState('');
    const [sent, setSent] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');
        try {
            const r = await api.post('/auth/forgot-password', { email });
            setSent(r.data.message);
        } catch (err) {
            setError(apiError(err, 'Could not send the link. Please try again.'));
        } finally {
            setIsLoading(false);
        }
    };

    if (sent) {
        return (
            <div className="card text-center">
                <MailCheck className="mx-auto mb-3 h-10 w-10 text-green-600" />
                <h2 className="mb-2 text-xl font-bold text-slate-800">Check your email</h2>
                <p className="text-sm text-slate-600">{sent}</p>
                <p className="mt-3 text-xs text-slate-500">No email after a few minutes? Check the spam folder, or ask your company admin to send you a link from Users.</p>
                <Link to="/login" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
                    Back to sign in
                </Link>
            </div>
        );
    }

    return (
        <div className="card">
            <h2 className="mb-2 text-2xl font-bold text-slate-800">Forgot password?</h2>
            <p className="mb-6 text-sm text-slate-600">Enter the email you sign in with. We'll send you a link to set a new password.</p>
            {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>}
            <form onSubmit={submit} className="space-y-4">
                <Input label="Email Address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus placeholder="you@example.com" />
                <Button type="submit" className="w-full" isLoading={isLoading}>
                    Send reset link
                </Button>
            </form>
            <p className="mt-4 text-center text-sm text-slate-600">
                Remembered it?{' '}
                <Link to="/login" className="font-medium text-primary hover:underline">
                    Sign in
                </Link>
            </p>
        </div>
    );
};
