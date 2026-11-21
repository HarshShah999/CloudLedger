import React from 'react';

/**
 * Taalmel mark: two corner strokes (white and saffron) that lock into a square.
 * Debit meets credit, books meet bank: "taalmel" means things in sync.
 */
export const LogoMark: React.FC<{ size?: number; className?: string; title?: string }> = ({ size = 40, className, title = 'Taalmel' }) => (
    <svg width={size} height={size} viewBox="0 0 512 512" className={className} role="img" aria-label={title}>
        <rect width="512" height="512" rx="120" fill="#4F46E5" />
        <polyline points="150,318 150,150 318,150" fill="none" stroke="#fff" strokeWidth="64" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points="194,362 362,362 362,194" fill="none" stroke="#FBBF24" strokeWidth="64" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

/** "taalmel" wordmark; `tone` picks colours for light or dark backgrounds. */
export const LogoWordmark: React.FC<{ tone?: 'light' | 'dark'; className?: string }> = ({ tone = 'light', className = '' }) => (
    <span className={`font-extrabold tracking-tight ${tone === 'dark' ? 'text-white' : 'text-indigo-950'} ${className}`}>
        taal<span className={tone === 'dark' ? 'text-indigo-300' : 'text-primary'}>mel</span>
    </span>
);

/** Mark and wordmark side by side. */
export const Logo: React.FC<{ size?: number; tone?: 'light' | 'dark'; textClassName?: string }> = ({ size = 40, tone = 'light', textClassName = 'text-2xl' }) => (
    <span className="inline-flex items-center gap-2.5">
        <LogoMark size={size} />
        <LogoWordmark tone={tone} className={textClassName} />
    </span>
);
