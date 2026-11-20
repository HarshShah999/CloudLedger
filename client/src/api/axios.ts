import axios from 'axios';

export const API_URL: string = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const api = axios.create({
    baseURL: API_URL,
    headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    // Lets the server know which company a request is for when the URL doesn't say.
    const companyId = localStorage.getItem('selectedCompanyId');
    if (companyId && !config.headers['X-Company-Id']) config.headers['X-Company-Id'] = companyId;
    return config;
});

api.interceptors.response.use(
    (response) => response,
    async (error) => {
        if (error.response?.status === 401 && !String(error.config?.url || '').includes('/auth/login')) {
            localStorage.removeItem('token');
            window.location.href = '/login';
        }
        // Blob responses (PDF/Excel downloads) carry JSON errors as Blobs: decode them
        // so callers can show error.response.data.message.
        const data = error.response?.data;
        if (data instanceof Blob && data.type.includes('json')) {
            try {
                error.response.data = JSON.parse(await data.text());
            } catch {
                /* ignore */
            }
        }
        return Promise.reject(error);
    }
);

/** Extracts a user-facing message from an API error. */
export const apiError = (error: any, fallback = 'Something went wrong') =>
    error?.response?.data?.message || error?.message || fallback;

export default api;
