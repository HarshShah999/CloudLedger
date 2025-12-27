import toast from 'react-hot-toast';

export const notify = {
  success: (message: string) => toast.success(message, {
    style: {
      background: '#22c55e', // green-500
      color: '#fff',
      padding: '16px',
      borderRadius: '8px',
    },
    iconTheme: {
      primary: '#fff',
      secondary: '#22c55e',
    },
  }),
  error: (message: string) => toast.error(message, {
    style: {
      background: '#ef4444', // red-500
      color: '#fff',
      padding: '16px',
      borderRadius: '8px',
    },
    iconTheme: {
      primary: '#fff',
      secondary: '#ef4444',
    },
  }),
  warning: (message: string) => toast(message, {
    icon: '⚠️',
    style: {
      background: '#eab308', // yellow-500
      color: '#fff',
      padding: '16px',
      borderRadius: '8px',
    },
  }),
};
