import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api.js';
import {
  computeBalances,
  formatMinor,
  minorDigitsFor,
  sharesForLine,
  validateEvent,
  type ExpenseEvent,
  type ExpenseLine,
} from '../domain/index.js';
import { LineEditor } from './LineEditor.js';
import { PeopleEditor } from './PeopleEditor.js';
import { PrintView } from './PrintView.js';
import { SettleTab } from './Settle.js';
import { Money, SettleStatus, formatDay } from './ui.js';

type Tab = 'expenses' | 'settle' | 'people';

export function EventScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const [event, setEvent] = useState<ExpenseEvent | null>(null);
  const [tab, setTab] = useState<Tab>('expenses');
  const [editing, setEditing] = useState<ExpenseLine | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef<ExpenseEvent | null>(null);

  useEffect(() => {
    api
      .getEvent(id)
      .then((payload) => setEvent(payload.event))
      .catch(() => setNotice('Could not load this event.'));
  }, [id]);

  /**
   * Saves are whole-document replaces guarded by the etag. A 409 means the
   * other device won, so rather than silently clobbering it we reload and say
   * so — losing one edit you can redo beats losing a whole evening's entries.
   */
  const save = useCallback(async (next: ExpenseEvent) => {
    pending.current = next;
    setEvent(next);
    setSaving(true);
    setNotice('');
    try {
      const payload = await api.saveEvent(next);
      if (pending.current === next) setEvent(payload.event);
    } catch (error) {
      if (error instanceof ApiError && error.isConflict) {
        const fresh = await api.getEvent(next.id);
        setEvent(fresh.event);
        setNotice('This event changed on another device, so your last edit was not saved. Reloaded.');
      } else {
        setNotice(
          error instanceof ApiError ? error.message : 'Could not save. Check your connection.',
        );
      }
    } finally {
      setSaving(false);
    }
  }, []);

  if (!event) {
    return (
      <div className="shell">
        <div className="topbar">
          <button className="btn btn--ghost btn--sm" onClick={onBack}>
            Back
          </button>
          <div className="topbar__title">
            <h1>{notice ? 'Not available' : 'Loading…'}</h1>
          </div>
        </div>
        {notice ? <p className="banner" style={{ margin: '1rem' }}>{notice}</p> : null}
      </div>
    );
  }

  const balances = computeBalances(event);
  const issues = validateEvent(event);
  const digits = balances.homeDigits;
  const closed = event.status === 'closed';
  const memberName = (memberId: string) =>
    event.members.find((m) => m.id === memberId)?.name ?? '—';

  const grouped = [...event.lines]
    .sort((a, b) => b.date.localeCompare(a.date))
    .reduce<Record<string, ExpenseLine[]>>((acc, line) => {
      (acc[line.date] ??= []).push(line);
      return acc;
    }, {});

  const upsertLine = (line: ExpenseLine) => {
    const exists = event.lines.some((l) => l.id === line.id);
    save({
      ...event,
      lines: exists ? event.lines.map((l) => (l.id === line.id ? line : l)) : [...event.lines, line],
    });
    setEditing(null);
    setAdding(false);
  };

  return (
    <>
      <div className="shell no-print">
        <div className="topbar">
          <button className="btn btn--ghost btn--sm" onClick={onBack}>
            Back
          </button>
          <div className="topbar__title">
            <h1>{event.name}</h1>
            <div className="topbar__sub">
              <Money minor={balances.totalSpentMinor} digits={digits} /> {event.homeCurrency}
              {saving ? ' · saving…' : ''}
            </div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={() => window.print()}>
            Export
          </button>
        </div>

        <div className="tabs">
          {(['expenses', 'settle', 'people'] as Tab[]).map((name) => (
            <button
              key={name}
              className="tab"
              role="tab"
              aria-selected={tab === name}
              onClick={() => setTab(name)}
            >
              {name === 'expenses' ? 'Expenses' : name === 'settle' ? 'Settle' : 'People'}
            </button>
          ))}
        </div>

        {notice ? (
          <p className="banner" style={{ margin: '1rem 1rem 0' }}>
            {notice}
          </p>
        ) : null}

        {tab === 'expenses' ? (
          <>
            <div className="stack" style={{ paddingBottom: 0 }}>
              <SettleStatus balances={balances} closed={closed} />
              {issues.some((i) => i.severity === 'error') ? (
                <p className="banner">
                  {issues.filter((i) => i.severity === 'error').length} expense
                  {issues.filter((i) => i.severity === 'error').length === 1 ? ' needs' : 's need'}{' '}
                  attention before this can be settled.
                </p>
              ) : null}
            </div>

            {event.members.length === 0 ? (
              <div className="empty">
                <h2>Add who is coming</h2>
                <p>You need at least one person before you can add an expense.</p>
                <button className="btn" onClick={() => setTab('people')}>
                  Add people
                </button>
              </div>
            ) : event.lines.length === 0 ? (
              <div className="empty">
                <h2>No expenses yet</h2>
                <p>Add the first one and the split works itself out.</p>
              </div>
            ) : (
              <div style={{ padding: '0 1rem 1rem' }}>
                {Object.entries(grouped).map(([date, lines]) => (
                  <div key={date}>
                    <div className="daygroup">{formatDay(date)}</div>
                    <div className="card card--flush">
                      {lines.map((line) => {
                        const shares = sharesForLine(line, event);
                        const total = Object.values(shares).reduce((a, b) => a + b, 0);
                        const lineDigits = minorDigitsFor(line.currency, event.currencyDigits);
                        return (
                          <button
                            className="listitem"
                            key={line.id}
                            onClick={() => setEditing(line)}
                          >
                            <span className="grow">
                              <strong className="truncate" style={{ display: 'block' }}>
                                {line.name}
                              </strong>
                              <span className="faint">
                                {memberName(line.payerId)} paid · {line.participantIds.length} sharing
                              </span>
                            </span>
                            <span style={{ textAlign: 'right' }}>
                              <Money minor={total} digits={digits} />
                              {line.currency !== event.homeCurrency ? (
                                <span className="faint" style={{ display: 'block' }}>
                                  {line.currency} {formatMinor(line.amountMinor, lineDigits)}
                                </span>
                              ) : null}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}

        {tab === 'settle' ? (
          <>
            <div className="stack" style={{ paddingBottom: 0 }}>
              <SettleStatus balances={balances} closed={closed} />
            </div>
            <SettleTab event={event} onChange={save} />
            <div className="stack">
              {closed ? (
                <button
                  className="btn btn--block"
                  onClick={() => save({ ...event, status: 'open' })}
                >
                  Reopen event
                </button>
              ) : (
                <button
                  className="btn btn--primary btn--block"
                  disabled={!balances.isBalanced}
                  title={
                    balances.isBalanced ? undefined : 'Settle every balance before closing'
                  }
                  onClick={() => save({ ...event, status: 'closed' })}
                >
                  Close event
                </button>
              )}
              <button className="btn btn--block" onClick={() => window.print()}>
                Export as PDF
              </button>
            </div>
          </>
        ) : null}

        {tab === 'people' ? (
          <>
            <PeopleEditor event={event} onChange={save} />
            <div className="stack">
              <button
                className="btn btn--danger btn--block"
                onClick={async () => {
                  if (!confirm(`Delete "${event.name}" and everything in it?`)) return;
                  await api.deleteEvent(event.id);
                  onBack();
                }}
              >
                Delete this event
              </button>
            </div>
          </>
        ) : null}

        {tab === 'expenses' && event.members.length > 0 && !closed ? (
          <button className="btn btn--primary fab" onClick={() => setAdding(true)}>
            Add expense
          </button>
        ) : null}

        {adding ? (
          <LineEditor
            event={event}
            line={null}
            onSave={upsertLine}
            onClose={() => setAdding(false)}
          />
        ) : null}

        {editing ? (
          <LineEditor
            event={event}
            line={editing}
            onSave={upsertLine}
            onClose={() => setEditing(null)}
            onDelete={() => {
              save({ ...event, lines: event.lines.filter((l) => l.id !== editing.id) });
              setEditing(null);
            }}
          />
        ) : null}
      </div>

      <PrintView event={event} />
    </>
  );
}
