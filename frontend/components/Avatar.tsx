import { cn, getInitials } from "@/lib/utils";

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizes = {
  sm: "h-9 w-9 text-xs",
  md: "h-11 w-11 text-sm",
  lg: "h-16 w-16 text-lg",
};

export default function Avatar({ name, src, size = "md", className }: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn(
          "rounded-full object-cover ring-2 ring-white dark:ring-zinc-800",
          sizes[size],
          className
        )}
      />
    );
  }

  const hue = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full font-semibold text-white ring-2 ring-white dark:ring-zinc-800",
        sizes[size],
        className
      )}
      style={{ backgroundColor: `hsl(${hue}, 55%, 52%)` }}
      aria-label={name}
    >
      {getInitials(name)}
    </div>
  );
}
