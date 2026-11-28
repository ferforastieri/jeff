interface Props {
  className?: string;
}

/** The notification bell with Jeff's eyes, so alerts read as his. */
export default function JeffBell({ className }: Props) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={className}
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5.5 13.5V9a4.5 4.5 0 0 1 9 0v4.5l1.2 1.5H4.3zM8.5 17h3" />
      <circle cx="8.2" cy="9.6" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="11.8" cy="9.6" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}
