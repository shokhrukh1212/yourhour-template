export function Logo({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className={className}>
      <path d="M39.2 22.1A15.8 15.8 0 1 1 26 8.4" stroke="#0a2944" strokeWidth="5.2" strokeLinecap="round" />
      <path d="M27.4 8.7A15.8 15.8 0 0 1 37.8 17" stroke="#ff4c3f" strokeWidth="5.2" strokeLinecap="square" />
      <path d="m24 24 10-11" stroke="#0a2944" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="24" cy="24" r="2.7" fill="#ff4c3f" />
    </svg>
  );
}
