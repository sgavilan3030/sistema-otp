import React from 'react';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'w-8 h-8 rounded-lg',
  md: 'w-10 h-10 rounded-xl',
  lg: 'w-14 h-14 rounded-2xl',
};

export const BrandLogo: React.FC<BrandLogoProps> = ({ size = 'md', className = '' }) => {
  return (
    <div
      className={`${SIZE_CLASSES[size]} bg-gradient-to-br from-slate-900 via-emerald-950/90 to-slate-950 border border-emerald-500/40 flex items-center justify-center shadow-lg shadow-emerald-500/15 shrink-0 ${className}`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-[74%] h-[74%]"
      >
        <defs>
          <linearGradient id="bhBrandGrad" x1="6" y1="8" x2="34" y2="34" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#f8fafc" />
            <stop offset="45%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
        </defs>

        {/* Precision Hexagon Crest */}
        <path
          d="M20 4.5L33 12V28L20 35.5L7 28V12L20 4.5Z"
          stroke="url(#bhBrandGrad)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeOpacity="0.35"
        />

        {/* Minimalist Executive Silhouette */}
        <path
          d="M14 18.5L15.8 11.8C16.2 10.6 17.4 10.2 20 10.2C22.6 10.2 23.8 10.6 24.2 11.8L26 18.5"
          stroke="#f8fafc"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M14.3 16.5H25.7" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M9.5 19.8C14.5 21.8 25.5 21.8 30.5 19.8" stroke="url(#bhBrandGrad)" strokeWidth="2.1" strokeLinecap="round" />

        {/* Enterprise Voice Signal Bars */}
        <rect x="13" y="25.5" width="2.2" height="4.5" rx="1.1" fill="#34d399" />
        <rect x="16.9" y="23.5" width="2.2" height="8" rx="1.1" fill="#6ee7b7" />
        <rect x="20.9" y="24.2" width="2.2" height="6.6" rx="1.1" fill="#34d399" />
        <rect x="24.8" y="25.8" width="2.2" height="4" rx="1.1" fill="#38bdf8" />
      </svg>
    </div>
  );
};

interface BrandWordmarkProps {
  variant?: 'sidebar' | 'topbar' | 'hero';
  subtitle?: string;
}

export const BrandWordmark: React.FC<BrandWordmarkProps> = ({
  variant = 'sidebar',
  subtitle,
}) => {
  if (variant === 'hero') {
    return (
      <div className="space-y-1.5" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        <h2 className="text-4xl xl:text-5xl font-extrabold tracking-tight leading-[1.05] text-white drop-shadow-[0_6px_28px_rgba(16,185,129,0.35)]">
          <span className="text-white">Black Hat</span>{' '}
          <span className="bg-gradient-to-r from-emerald-300 via-teal-200 to-cyan-300 bg-clip-text text-transparent font-bold">
            Dialer System
          </span>
        </h2>
        {subtitle && (
          <p className="text-xs sm:text-sm text-slate-300 font-medium tracking-wide max-w-md ml-auto">
            {subtitle}
          </p>
        )}
      </div>
    );
  }

  if (variant === 'topbar') {
    return (
      <div style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        <h1 className="text-sm sm:text-[15px] font-extrabold tracking-tight leading-tight">
          <span className="text-white">Black Hat</span>{' '}
          <span className="bg-gradient-to-r from-emerald-300 to-cyan-300 bg-clip-text text-transparent font-semibold">
            Dialer System
          </span>
        </h1>
        {subtitle && (
          <p className="text-[9px] text-slate-400 font-mono tracking-[0.14em] uppercase mt-0.5">
            {subtitle}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <h1 className="text-[13px] font-extrabold tracking-tight leading-tight truncate">
        <span className="text-white">Black Hat</span>{' '}
        <span className="text-emerald-400 font-semibold">Dialer System</span>
      </h1>
      {subtitle && (
        <p className="text-[10px] text-slate-400 font-mono tracking-[0.12em] uppercase mt-0.5 truncate">
          {subtitle}
        </p>
      )}
    </div>
  );
};
