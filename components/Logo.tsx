export function Logo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="yh-mark" x1="8" y1="4" x2="34" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4f6df5" />
          <stop offset="1" stopColor="#9333ea" />
        </linearGradient>
      </defs>
      <g strokeLinecap="round" fill="none">
        <path d="M15 34 V22" stroke="currentColor" strokeWidth="6" />
        <path d="M15 22 6 9" stroke="currentColor" strokeWidth="6" />
        <path d="M15 22 24 7" stroke="url(#yh-mark)" strokeWidth="6" />
      </g>
      <g stroke="url(#yh-mark)" strokeWidth="3" strokeLinecap="round">
        <path d="M27 10 31 7" opacity="1" />
        <path d="M31 15.5 36.5 14.5" opacity="0.8" />
        <path d="M31 21 36 22" opacity="0.6" />
        <path d="M28 26.5 31 29.5" opacity="0.4" />
        <path d="M23.5 30.5 24.5 34" opacity="0.25" />
      </g>
    </svg>
  );
}
