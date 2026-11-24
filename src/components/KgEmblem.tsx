import React from 'react';

interface KgEmblemProps {
  size?: number;
  className?: string;
}

export const KgEmblem: React.FC<KgEmblemProps> = ({ size = 36, className = '' }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      role="img"
      aria-label="KG Emblem"
      className={`shrink-0 aspect-square rounded-full bg-slate-900 dark:bg-slate-950 text-white border border-slate-200 dark:border-slate-700 ${className}`}
    >
      {/* Circular G ring with horizontal crossbar matching the KG brand emblem */}
      <path
        d="M 107.1 34.9 A 52 52 0 1 0 115.5 57 L 76 57 L 76 68 L 104.8 68 A 41 41 0 1 1 98.0 41.1 Z"
        fill="currentColor"
      />
      {/* Crisp geometric K monogram inside the circle */}
      <path
        d="M 39 38 H 49 V 89 H 39 Z M 49 58 L 71 38 H 84 L 56 64 Z M 55 59 L 84 89 H 71 L 49 66 Z"
        fill="currentColor"
      />
    </svg>
  );
};
