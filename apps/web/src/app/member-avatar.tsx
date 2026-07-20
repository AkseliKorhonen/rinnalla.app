type Props = {
  className?: string;
  image: string | null | undefined;
  label: string;
};

function initials(label: string) {
  const parts = label
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function MemberAvatar({
  className = "size-12",
  image,
  label,
}: Props) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center overflow-hidden rounded-full border border-stone-700 bg-stone-800 text-sm font-semibold text-amber-100 ${className}`}
    >
      {image ? (
        // Convex storage URLs should be loaded directly rather than cached by Next Image.
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className="size-full object-cover" src={image} />
      ) : (
        initials(label)
      )}
    </span>
  );
}
