export function Logo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-label="LobangLah! logo"
      role="img"
    >
      <path
        d="M27.4 15.4 16.8 4.8A2.5 2.5 0 0 0 15.03 4H6.5A2.5 2.5 0 0 0 4 6.5v8.53c0 .663.264 1.299.732 1.768l10.6 10.6a2.5 2.5 0 0 0 3.536 0l8.532-8.53a2.5 2.5 0 0 0 0-3.536Z"
        fill="currentColor"
      />
      <circle cx="10.5" cy="10.5" r="2.25" fill="hsl(var(--background))" />
    </svg>
  );
}
