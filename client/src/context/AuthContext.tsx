import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/axios';

interface User {
    id: string;
    name: string;
    email: string;
    role: string;
    is_superadmin?: boolean;
}

interface AuthContextType {
    user: User | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    /** Called after a successful login/register: the server has already set the session cookies. */
    login: (user: User) => void;
    logout: () => Promise<void>;
    setUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // Tokens are no longer kept in page storage (older versions did)
        localStorage.removeItem('token');
        // The session cookie (if any) tells us who is signed in
        api.get('/auth/me', { skipAuthRedirect: true } as any)
            .then((r) => setUser(r.data.data.user))
            .catch(() => setUser(null))
            .finally(() => setIsLoading(false));
    }, []);

    const login = (newUser: User) => setUser(newUser);

    const logout = async () => {
        try {
            await api.post('/auth/logout');
        } catch {
            /* signed out locally either way */
        }
        localStorage.removeItem('selectedCompanyId');
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout, setUser }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
