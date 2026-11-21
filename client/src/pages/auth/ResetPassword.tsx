import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, LinkIcon } from 'lucide-react';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import api, { apiError } from '../../api/axios';
import { Logo } from '../../components/Logo';

/** Step 2: the page the emailed link opens. Sets a new password with a one-time token. */
export const ResetPassword: React.FC = () => {
    // Read the token once, then take it out of the address bar (and browser history)
    const [token] = useState(() => new URLSearchParams(window.location.search).get('token') || '');
    const [state, setState] = useState<'checking' | 'invalid' | 'ready' | 'done'>(token ? 'checking' : 'invalid');
    const [account, setAccount] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!token) return;
        window.history.replaceState(null, '', '/reset-password');
        api.get(`/auth/reset-password/${encodeURIComponent(token)}`)
            .then((r) => {
                if (r.data.data.valid) {
                    setAccount(r.data.data.email);
                    setState('ready');
                } else setState('invalid');
            })
            .catch(() => setState('invalid'));
    }, [token]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (password.length < 8) return setError('Use at least 8 characters.');
        if (password !== confirm) return setError('The two passwords do not match.');
        setIsLoading(true);
        try {
            await api.post('/auth/reset-password', { token, password });
            setState('done');
        } catch (err) {
            setError(apiError(err, 'Could not change the password.'));
        } finally {
            setIsLoading(false);
        }
    };

    let body: React.ReactNode;
    if (state === 'checking') body = <div className="card text-center text-slate-500">Checking your link…</div>;
    else if (state === 'invalid')
        body = (
            <div className="card text-center">
                <LinkIcon className="mx-auto mb-3 h-10 w-10 text-amber-500" />
                <h2 className="mb-2 text-xl font-bold text-slate-800">This link can't be used</h2>
                <p className="text-sm text-slate-600">Reset links work once and expire after 30 minutes. Only the newest link you requested works.</p>
                <Link to="/forgot-password" className="btn btn-primary mt-6 inline-flex">Send a new link</Link>
            </div>
        );
    else if (state === 'done')
        body = (
            <div className="card text-center">
                <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-green-600" />
                <h2 className="mb-2 text-xl font-bold text-slate-800">Password changed</h2>
                <p className="text-sm text-slate-600">You've been signed out on all devices. Sign in with your new password.</p>
                <Link to="/login" className="btn btn-primary mt-6 inline-flex">Sign in</Link>
            </div>
        );
    else
        body = (
            <div className="card">
                <h2 className="mb-2 text-2xl font-bold text-slate-800">Set a new password</h2>
                <p className="mb-6 text-sm text-slate-600">For the account {account}.</p>
                {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>}
                <form onSubmit={submit} className="space-y-4">
                    <Input label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus placeholder="At least 8 characters" />
                    <Input label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
                    <Button type="submit" className="w-full" isLoading={isLoading}>
                        Change password
                    </Button>
                </form>
            </div>
        );

    // Its own frame (not the sign-in layout), so the link works even in a browser that is signed in
    return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
            <div className="w-full max-w-md">
                <div className="mb-8 text-center">
                    <h1 className="inline-flex justify-center"><Logo size={48} textClassName="text-4xl" /></h1>
                </div>
                {body}
            </div>
        </div>
    );
};
