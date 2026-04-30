import type { CSSProperties } from "react";

type MaterialIconProps = {
  /** Material Symbols icon name (e.g. `home`, `chat`, `person`) */
  name: string;
  className?: string;
  style?: CSSProperties;
  /** Visually hidden label for screen readers */
  label?: string;
  size?: number;
  fill?: 0 | 1;
};

/**
 * Google Material Symbols (Outlined) — requires `MaterialIconFont` in root layout.
 */
export function MaterialIcon({
  name,
  className = "",
  style,
  label,
  size = 24,
  fill = 0,
}: MaterialIconProps) {
  return (
    <span
      className={`material-symbols-outlined ${className}`.trim()}
      style={{
        fontSize: size,
        fontVariationSettings: `"FILL" ${fill}, "wght" 400, "GRAD" 0, "opsz" 24`,
        ...style,
      }}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {name}
    </span>
  );
}
