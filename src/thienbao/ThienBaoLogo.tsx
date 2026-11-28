export function ThienBaoLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" className="logo">
      <rect width="64" height="64" rx="14" fill="#1d4ed8" />
      <path
        d="M32 15a4 4 0 0 1 4 4c0 1.8-1.2 3.3-2.9 3.8L32 24.5 14 36.2a3.2 3.2 0 0 0 1.7 5.8h32.6a3.2 3.2 0 0 0 1.7-5.8L32 24.5"
        stroke="#ffffff"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M21 48h22" stroke="#93c5fd" strokeWidth="3" strokeLinecap="round" strokeDasharray="4 5" />
    </svg>
  )
}
