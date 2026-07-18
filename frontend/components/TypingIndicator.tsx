"use client";

interface TypingIndicatorProps {
  names: string[];
}

export default function TypingIndicator({ names }: TypingIndicatorProps) {
  if (names.length === 0) return null;

  const label =
    names.length === 1
      ? `${names[0]} is typing`
      : `${names.slice(0, 2).join(", ")} are typing`;

  return (
    <div className="px-6 pb-2">
      <div className="mx-auto flex max-w-3xl items-center gap-2 text-sm text-muted">
        <span className="flex gap-1">
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted" />
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted [animation-delay:0.15s]" />
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted [animation-delay:0.3s]" />
        </span>
        {label}…
      </div>
    </div>
  );
}
