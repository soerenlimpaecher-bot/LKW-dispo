"use client";

import { STATUS_COLOR, STATUS_LABEL, type EffectiveStatus } from "@/lib/format";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "md" | "lg" | "xl";
  busy?: boolean;
};

const VARIANT = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-900 disabled:bg-stone-300",
  secondary: "bg-white text-stone-900 ring-1 ring-stone-300 hover:bg-stone-50 active:bg-stone-100 disabled:text-stone-400",
  danger: "bg-white text-red-700 ring-1 ring-red-300 hover:bg-red-50 active:bg-red-100 disabled:text-stone-400",
  ghost: "text-stone-700 hover:bg-stone-200/60 disabled:text-stone-400",
};
const SIZE = { md: "px-3 py-2 text-sm", lg: "px-4 py-3 text-base", xl: "px-5 py-4 text-lg" };

export function Button({ variant = "primary", size = "lg", busy, className = "", children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    >
      {busy && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <section className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200 ${className}`}>{children}</section>;
}

export function StatusBadge({ status }: { status: EffectiveStatus }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-sm font-semibold whitespace-nowrap ring-1 ${STATUS_COLOR[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: React.ReactNode }) {
  const c = {
    info: "bg-sky-50 text-sky-900 ring-sky-200",
    warn: "bg-amber-50 text-amber-900 ring-amber-200",
    error: "bg-red-50 text-red-800 ring-red-200",
    ok: "bg-brand-50 text-brand-900 ring-brand-100",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl px-3 py-2.5 text-sm ring-1 ${c}`}>
      {children}
    </div>
  );
}

export function Spinner({ label = "Wird geladen …" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-stone-500" role="status">
      <span className="size-6 animate-spin rounded-full border-[3px] border-stone-300 border-t-brand-600" aria-hidden />
      {label}
    </div>
  );
}
