import React from 'react';

interface LogoProps {
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({ className }) => {
  return (
    <svg 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg" 
      className={className}
    >
      <defs>
        <linearGradient id="logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--primary, #E69F00)" />
          <stop offset="100%" stopColor="var(--accent, #3b82f6)" />
        </linearGradient>
      </defs>
      {/* Outer stylized hex/circle */}
      <path 
        d="M50 5 L89 27.5 L89 72.5 L50 95 L11 72.5 L11 27.5 Z" 
        stroke="url(#logo-gradient)" 
        strokeWidth="4" 
        strokeLinejoin="round"
        fill="rgba(16, 185, 129, 0.1)"
      />
      {/* Central "QAI" Text */}
      <text 
        x="50%" 
        y="55%" 
        dominantBaseline="middle" 
        textAnchor="middle" 
        fill="white" 
        fontSize="28" 
        fontWeight="900" 
        fontFamily="system-ui, sans-serif"
        letterSpacing="-1"
      >
        QAI
      </text>
      {/* Connection dots for AI feel */}
      <circle cx="50" cy="5" r="3" fill="url(#logo-gradient)" />
      <circle cx="89" cy="27.5" r="3" fill="url(#logo-gradient)" />
      <circle cx="89" cy="72.5" r="3" fill="url(#logo-gradient)" />
      <circle cx="50" cy="95" r="3" fill="url(#logo-gradient)" />
      <circle cx="11" cy="72.5" r="3" fill="url(#logo-gradient)" />
      <circle cx="11" cy="27.5" r="3" fill="url(#logo-gradient)" />
    </svg>
  );
};
