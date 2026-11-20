import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import api from '../../api/axios';

export const Register: React.FC = () => {
    const { login } = useAuth();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');


        try {
            const response = await api.post('/auth/register', { name, email, password });
            console.log('✅ Registration successful:', response.data);
            login(response.data.token, response.data.data.user);
        } catch (err: any) {
            console.error('❌ Registration failed:', err);
            console.error('Error response:', err.response);
            setError(err.response?.data?.message || 'Registration failed');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="card">
            <h2 className="text-2xl font-bold text-slate-800 mb-6">Create Account</h2>
            {error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">
                    {error}
                </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                    label="Full Name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    placeholder="John Doe"
                />
                <Input
                    label="Email Address"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="you@example.com"
                />
                <Input
                    label="Password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                    minLength={8}
                />
                <Button type="submit" className="w-full" isLoading={isLoading}>
                    Create Account
                </Button>
            </form>
            <p className="mt-4 text-center text-sm text-slate-600">
                Already have an account?{' '}
                <Link to="/login" className="text-primary hover:underline font-medium">
                    Sign in
                </Link>
            </p>
        </div>
    );
};
