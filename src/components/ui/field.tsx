import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export const inputClass =
  "block w-full rounded-lg border border-line-strong bg-surface px-3 h-10 text-sm text-ink placeholder:text-ink-muted shadow-xs focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-subtle disabled:text-ink-muted aria-[invalid=true]:border-danger";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  optionalLabel,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: ReactNode;
  optionalLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
        {optionalLabel && <span className="ms-1 font-normal text-ink-muted">({optionalLabel})</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(inputClass, className)} {...props} />;
}

/**
 * Masked digits for the management PIN. Deliberately not type="password":
 * browsers would then offer to save it as a website password on every save.
 */
export function PinInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      type="text"
      dir="ltr"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      maxLength={12}
      data-1p-ignore
      data-lpignore="true"
      className={cn(inputClass, "[-webkit-text-security:disc]", className)}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(inputClass, "h-auto min-h-20 py-2", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(inputClass, "pe-8", className)} {...props} />;
}
