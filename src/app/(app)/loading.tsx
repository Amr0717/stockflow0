export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-live="polite">
      <div className="h-7 w-48 rounded-md bg-line" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 rounded-xl bg-line/70" />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-line/60" />
    </div>
  );
}
