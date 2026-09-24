import { useEffect, type ReactNode } from 'react';
import { formatMinor, type Balances, type GroupBalance } from '../domain/index.js';

export function Money({
  minor,
  digits = 2,
  signed = false,
  className = '',
}: {
  minor: number;
  digits?: number;
  signed?: boolean;
  className?: string;
}) {
  const tone = !signed ? '' : minor > 0 ? ' money--credit' : minor < 0 ? ' money--debt' : ' money--zero';
  const text = signed && minor > 0 ? `+${formatMinor(minor, digits)}` : formatMinor(minor, digits);
  return <span className={`money${tone} ${className}`.trim()}>{text}</span>;
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {error ? <span className="field__error">{error}</span> : null}
    </label>
  );
}

export function Sheet({
  title,
  onClose,
  children,
  action,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  action?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="sheet__scrim no-print"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet">
        <div className="sheet__head">
          <h2>{title}</h2>
          <div className="row">
            {action}
            <button className="btn btn--ghost btn--sm" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SettleStatus({
  balances,
  closed,
}: {
  balances: Balances;
  closed: boolean;
}) {
  if (closed) {
    return (
      <div className="status status--settled">
        <span className="status__mark" aria-hidden="true">
          ✓
        </span>
        <span>Closed and settled</span>
      </div>
    );
  }
  if (balances.isBalanced) {
    return (
      <div className="status status--settled">
        <span className="status__mark" aria-hidden="true">
          ✓
        </span>
        <span>Everyone is square</span>
      </div>
    );
  }

  const outstanding = balances.byGroup
    .filter((g) => g.netMinor < 0)
    .reduce((sum, g) => sum + Math.abs(g.netMinor), 0);

  return (
    <div className="status status--open">
      <span className="status__mark" aria-hidden="true">
        ✕
      </span>
      <span>
        <Money minor={outstanding} digits={balances.homeDigits} /> still to settle
      </span>
    </div>
  );
}

/**
 * Debtors extend left of a shared centre axis, creditors right. Bar length is
 * proportional to the largest imbalance, so the shape of who owes whom reads
 * at a glance without parsing any of the numbers.
 */
export function BalanceStrip({ balances }: { balances: Balances }) {
  const groups: GroupBalance[] = [...balances.byGroup].sort((a, b) => b.netMinor - a.netMinor);
  const peak = Math.max(1, ...groups.map((g) => Math.abs(g.netMinor)));

  return (
    <div className="strip">
      {groups.map((group) => {
        const width = (Math.abs(group.netMinor) / peak) * 50;
        return (
          <div className="strip__row" key={group.groupId}>
            <span className="strip__name truncate" title={group.label}>
              {group.label}
            </span>
            <span className="strip__track">
              <span className="strip__axis" />
              {group.netMinor !== 0 ? (
                <span
                  className={`strip__bar strip__bar--${group.netMinor > 0 ? 'credit' : 'debt'}`}
                  style={{ width: `${width}%` }}
                />
              ) : null}
            </span>
            <span className="strip__amount">
              <Money minor={group.netMinor} digits={balances.homeDigits} signed />
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function formatDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
