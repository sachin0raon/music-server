import { Link } from "react-router-dom";
import { CaretLeftIcon as CaretLeft } from "@phosphor-icons/react";

export function BackLink({ to, children }) {
  return (
    <Link to={to} className="interactive -ml-2 mb-1 inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-small text-mute hover:text-ink">
      <CaretLeft size={16} />{children}
    </Link>
  );
}

export default function PageHeader({ title, subtitle, back, actions, className = "mb-5" }) {
  return (
    <header className={className}>
      {back && <BackLink to={back.to}>{back.label}</BackLink>}
      <div className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 truncate text-display font-semibold">{title}</h1>
        {actions}
      </div>
      {subtitle && <p className="mt-1 text-body text-mute">{subtitle}</p>}
    </header>
  );
}
