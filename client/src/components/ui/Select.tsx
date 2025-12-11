
import React from 'react';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    label?: string;
    error?: string;
}

export const Select: React.FC<SelectProps> = ({ label, error, className = '', children, ...props }) => {
    return (
        <div className="w-full">
            {label && (
                <label className="block text-sm font-medium text-slate-700 mb-1">
                    {label}
                </label>
            )}
            <select
                className={`w-full rounded-lg border-slate-300 focus:border-primary focus:ring-primary ${error ? 'border-red-500' : ''} ${className}`}
                {...props}
            >
                {children}
            </select>
            {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        </div>
    );
};
