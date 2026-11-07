export interface AvatarProps {
  /** The person's name: their initials are drawn, the name is the accessible name and the tooltip. */
  name: string;
  size?: "sm" | "md" | "lg";
  /** Inside a control that already names the person: hidden from assistive technology. */
  decorative?: boolean;
}

/** Up to two initials of a name, in any script (the first letter of the first and the last word). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = (word: string) => Array.from(word)[0] ?? "";
  const letters = words.length === 1 ? first(words[0]!) : first(words[0]!) + first(words[words.length - 1]!);
  return letters.toLocaleUpperCase();
}

/** A person's initials in a circle; the name in `title` and, unless decorative, as `role="img"`'s name. */
export function Avatar({ name, size = "md", decorative = false }: AvatarProps) {
  return (
    <span
      className={`pg-avatar pg-avatar--${size}`}
      title={name}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": name })}
    >
      {initials(name)}
    </span>
  );
}
