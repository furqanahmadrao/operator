export function ChatLoadingSkeleton() {
  return (
    <div className="skeleton-bubble mr-auto max-w-[80%]" aria-hidden="true">
      <div className="space-y-2.5">
        <div className="skeleton skeleton-row w-[72%]" />
        <div className="skeleton skeleton-row w-full" />
        <div className="skeleton skeleton-row w-[85%]" />
        <div className="skeleton skeleton-row w-[55%]" />
      </div>
    </div>
  );
}
