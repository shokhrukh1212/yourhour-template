export function Logo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true" className={className}>
      <rect width="28" height="28" rx="8" fill="#f5f6ef" />
      <path d="M14 21V13.8" stroke="#07080b" strokeWidth="3.2" strokeLinecap="round" />
      <path d="m8.3 7.1 5.7 7" stroke="#9b7cff" strokeWidth="3.2" strokeLinecap="round" />
      <path d="m19.7 7.1-5.7 7" stroke="#d7ff67" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}
