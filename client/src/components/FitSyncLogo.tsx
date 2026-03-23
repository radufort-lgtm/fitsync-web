export default function FitSyncLogo({ size = 28 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2">
      <svg aria-label="FitSync logo" viewBox="0 0 32 32" width={size} height={size} fill="none">
        <rect x="2" y="11" width="5" height="10" rx="1.5" fill="currentColor" className="text-primary" opacity="0.5"/>
        <rect x="9" y="7" width="14" height="18" rx="2.5" fill="currentColor" className="text-primary"/>
        <rect x="25" y="11" width="5" height="10" rx="1.5" fill="currentColor" className="text-primary" opacity="0.5"/>
        <circle cx="16" cy="16" r="3.5" fill="hsl(195 20% 6%)"/>
        <circle cx="16" cy="16" r="1.5" fill="currentColor" className="text-primary" opacity="0.8"/>
      </svg>
      <span
        style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}
        className="text-lg font-bold text-foreground tracking-tight"
      >
        FitSync
      </span>
    </div>
  );
}
