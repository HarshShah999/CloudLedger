import axios from 'axios';

export const API_URL: string = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const api = axios.create({
    baseURL: API_URL,
    // The session lives in httpOnly cookies that page scripts cannot read
    withCredentials: true,
    headers: {
        'Content-Type': 'application/json',
        // Required by the server for cookie-authenticated changes (blocks cross-site forgery)
        'X-Requested-With': 'XMLHttpRequest',
    },
});

api.interceptors.request.use((config) => {
    // Lets the server know which company a request is for when the URL doesn't say.
    const companyId = localStorage.getItem('selectedCompanyId');
    if (companyId && !config.headers['X-Company-Id']) config.headers['X-Company-Id'] = companyId;
    return config;
});

/** One refresh at a time, shared by every request that hit an expired access token. */
let refreshing: Promise<void> | null = null;
const refreshSession = () => {
    refreshing ??= axios
        .post(`${API_URL}/auth/refresh`, {}, { withCredentials: true, headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(() => undefined)
        .finally(() => {
            refreshing = null;
        });
    return refreshing;
};

const isAuthCall = (url = '') => /\/auth\/(login|register|refresh|logout)/.test(url);
const onPublicPage = () => /^\/(v\/|login|register|forgot-password|reset-password)/.test(window.location.pathname);

api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const config = error.config || {};
        if (error.response?.status === 401 && !isAuthCall(config.url) && !config._retried) {
            try {
                // The access token lasts minutes; the refresh cookie renews it quietly
                await refreshSession();
                return api({ ...config, _retried: true });
            } catch {
                if (!onPublicPage() && !config.skipAuthRedirect) window.location.href = '/login';
            }
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
