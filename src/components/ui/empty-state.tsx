import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({ icon: Icon, title, action }: { icon: LucideIcon; title: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-subtle text-ink-muted">
        <Icon aria-hidden className="size-5" />
      </div>
      <p className="max-w-sm text-sm text-ink-soft">{title}</p>
      {action}
    </div>
  );
}
