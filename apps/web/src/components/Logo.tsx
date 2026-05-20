interface Props {
  size?: number;
  withText?: boolean;
  className?: string;
}

export function Logo({ size = 24, withText = true, className = '' }: Props) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span
        className="inline-flex items-center justify-center text-primary"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 8 2 12 6 16" />
          <polyline points="18 8 22 12 18 16" />
          <line x1="14.5" y1="6" x2="9.5" y2="18" />
        </svg>
      </span>
      {withText && (
        <span className="font-semibold tracking-tight text-primary leading-none">
          opencoder
        </span>
      )}
    </span>
  );
}
