import type { ReactNode } from "react";

export function StatCard({
  label,
  value,
  suffix,
  tone = "blue",
  hint,
}: {
  label: string;
  value: ReactNode;
  suffix?: string;
  tone?: "green" | "blue" | "orange" | "yellow" | "red" | "purple";
  hint?: string;
}) {
  const map: Record<string, string> = {
    green: "bg-stat-green text-stat-green-fg",
    blue: "bg-stat-blue text-stat-blue-fg",
    orange: "bg-stat-orange text-stat-orange-fg",
    yellow: "bg-stat-yellow text-stat-yellow-fg",
    red: "bg-stat-red text-stat-red-fg",
    purple: "bg-stat-purple text-stat-purple-fg",
  };
  return (
    <div className={`rounded-xl p-5 ${map[tone]}`}>
      <div className="text-xs font-medium opacity-80">{label}</div>
      <div className="mt-2 text-3xl font-bold leading-none">{value}</div>
      {suffix && <div className="mt-1 text-xs opacity-80">{suffix}</div>}
      {hint && <div className="mt-2 text-xs opacity-70">{hint}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bg-card rounded-xl border shadow-sm ${className}`}>{children}</div>;
}

export function CardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b">
      <h3 className="font-semibold">{title}</h3>
      {action}
    </div>
  );
}

type BadgeTone =
  | "valid"
  | "pending"
  | "rejected"
  | "draft"
  | "info"
  | "neutral"
  | "review"
  | "planned";

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  const map: Record<BadgeTone, string> = {
    valid: "bg-status-valid text-status-valid-fg",
    pending: "bg-status-pending text-status-pending-fg",
    rejected: "bg-status-rejected text-status-rejected-fg",
    draft: "bg-status-draft text-status-draft-fg",
    info: "bg-stat-blue text-stat-blue-fg",
    neutral: "bg-muted text-muted-foreground",
    review: "bg-stat-orange text-stat-orange-fg",
    planned: "bg-stat-yellow text-stat-yellow-fg",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${map[tone]}`}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  asChild,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "danger" | "success" | "warning";
  asChild?: boolean;
}) {
  const styles: Record<string, string> = {
    primary: "bg-navy text-navy-foreground hover:bg-navy-hover",
    ghost: "hover:bg-accent text-foreground",
    outline: "border bg-card hover:bg-accent text-foreground",
    danger: "bg-destructive text-destructive-foreground hover:opacity-90",
    success: "bg-status-valid-fg text-white hover:opacity-90",
    warning: "bg-stat-orange-fg text-white hover:opacity-90",
  };
  return (
    <button
      className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
