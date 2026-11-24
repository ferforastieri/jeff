export interface JeffLoaderProps {
  src: string;
  label?: string;
  size?: number;
  className?: string;
}

/** The jumping Jeff used by every loading state. */
export function JeffLoader({ src, label, size = 24, className = "" }: JeffLoaderProps) {
  return (
    <span
      className={`jeff-loader ${className}`.trim()}
      role={label ? "status" : undefined}
      aria-label={label}
    >
      <span
        className="jeff-loader__stage"
        style={{ width: size * 1.35, height: size * 1.5 }}
        aria-hidden="true"
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="jeff-loader__hop"
          style={{ width: size, height: size }}
        />
        <span className="jeff-loader__shadow" style={{ width: size * 0.62 }} />
      </span>
      {label ? <span className="jeff-loader__label">{label}</span> : null}
    </span>
  );
}
