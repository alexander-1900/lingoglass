interface IconProps {
  size?: number;
}

const stroke = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconArrowLeft({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function IconArrowRight({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function IconPlay({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 4.7v14.6c0 .8.9 1.3 1.6.9l11-7.3c.6-.4.6-1.4 0-1.8l-11-7.3c-.7-.4-1.6.1-1.6.9z" />
    </svg>
  );
}

export function IconStop({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

export function IconPrev({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M19 20 9 12l10-8v16z" />
      <path d="M5 19V5" />
    </svg>
  );
}

export function IconNext({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="m5 4 10 8-10 8V4z" />
      <path d="M19 5v14" />
    </svg>
  );
}

export function IconSentencePlay({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 4.7v14.6c0 .8.9 1.3 1.6.9l11-7.3c.6-.4.6-1.4 0-1.8l-11-7.3c-.7-.4-1.6.1-1.6.9z" />
    </svg>
  );
}

export function IconClose({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}