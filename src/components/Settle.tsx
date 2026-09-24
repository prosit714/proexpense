import { useState } from 'react';
import {
  computeBalances,
  formatMinor,
  parseToMinor,
  suggestTransfers,
  type ExpenseEvent,
  type Transfer,
} from '../domain/index.js';
import { BalanceStrip, Money, Sheet, formatDay, today, uid } from './ui.js';

export function SettleTab({
  event,
  onChange,
}: {
  event: ExpenseEvent;
  onChange: (next: ExpenseEvent) => void;
}) {
  const balances = computeBalances(event);
  const transfers = suggestTransfers(balances);
  const [recording, setRecording] = useState<Transfer | null>(null);
  const [freeform, setFreeform] = useState(false);

  const memberName = (id: string) => event.members.find((m) => m.id === id)?.name ?? 'Someone';

  return (
    <div className="stack">
      <section className="card">
        <h3>Where everyone stands</h3>
        <p className="faint" style={{ margin: '0.25rem 0 0.875rem' }}>
          Families are shown as one line — they only need to balance as a family.
        </p>
        <BalanceStrip balances={balances} />
      </section>

      {transfers.length > 0 ? (
        <section className="card card--flush">
          <div style={{ padding: '1rem 1rem 0.5rem' }}>
            <h3>Settle up</h3>
            <p className="faint" style={{ margin: '0.25rem 0 0' }}>
              The fewest payments that clear everything.
            </p>
          </div>
          {transfers.map((transfer, index) => (
            <button
              className="listitem"
              key={`${transfer.fromGroupId}-${transfer.toGroupId}-${index}`}
              onClick={() => setRecording(transfer)}
            >
              <span className="grow">
                <strong>{transfer.fromLabel}</strong>{' '}
                <span className="muted">pays</span> <strong>{transfer.toLabel}</strong>
              </span>
              <Money minor={transfer.amountMinor} digits={balances.homeDigits} />
            </button>
          ))}
        </section>
      ) : (
        <p className="banner banner--info" style={{ margin: '0 1rem' }}>
          Nothing left to settle.
        </p>
      )}

      <section className="card card--flush">
        <div className="row row--between" style={{ padding: '1rem' }}>
          <h3>Payments recorded</h3>
          <button className="btn btn--sm" onClick={() => setFreeform(true)}>
            Add payment
          </button>
        </div>
        {event.settlements.length === 0 ? (
          <p className="faint" style={{ padding: '0 1rem 1rem', margin: 0 }}>
            None yet. Record a payment once cash actually changes hands.
          </p>
        ) : (
          event.settlements.map((settlement) => (
            <div className="listitem" key={settlement.id} style={{ cursor: 'default' }}>
              <span className="grow">
                <span>
                  {memberName(settlement.fromMemberId)} → {memberName(settlement.toMemberId)}
                </span>
                <span className="faint" style={{ display: 'block' }}>
                  {formatDay(settlement.date)}
                  {settlement.note ? ` · ${settlement.note}` : ''}
                </span>
              </span>
              <Money minor={settlement.amountMinor} digits={balances.homeDigits} />
              <button
                className="btn btn--ghost btn--sm"
                aria-label="Delete payment"
                onClick={() =>
                  onChange({
                    ...event,
                    settlements: event.settlements.filter((s) => s.id !== settlement.id),
                  })
                }
              >
                ✕
              </button>
            </div>
          ))
        )}
      </section>

      {recording || freeform ? (
        <RecordPayment
          event={event}
          transfer={recording}
          homeDigits={balances.homeDigits}
          onClose={() => {
            setRecording(null);
            setFreeform(false);
          }}
          onSave={(settlement) => {
            onChange({ ...event, settlements: [...event.settlements, settlement] });
            setRecording(null);
            setFreeform(false);
          }}
        />
      ) : null}
    </div>
  );
}

function RecordPayment({
  event,
  transfer,
  homeDigits,
  onClose,
  onSave,
}: {
  event: ExpenseEvent;
  transfer: Transfer | null;
  homeDigits: number;
  onClose: () => void;
  onSave: (settlement: ExpenseEvent['settlements'][number]) => void;
}) {
  const balances = computeBalances(event);
  const membersIn = (groupId: string | undefined) =>
    groupId
      ? (balances.byGroup.find((g) => g.groupId === groupId)?.memberIds ?? [])
      : event.members.map((m) => m.id);

  const fromOptions = membersIn(transfer?.fromGroupId);
  const toOptions = membersIn(transfer?.toGroupId);

  const [fromMemberId, setFromMemberId] = useState(fromOptions[0] ?? '');
  const [toMemberId, setToMemberId] = useState(toOptions[0] ?? '');
  const [amount, setAmount] = useState(
    transfer ? formatMinor(transfer.amountMinor, homeDigits) : '',
  );
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const save = () => {
    setError('');
    if (!fromMemberId || !toMemberId || fromMemberId === toMemberId) {
      return setError('Pick two different people.');
    }
    let amountMinor: number;
    try {
      amountMinor = parseToMinor(amount, homeDigits);
    } catch {
      return setError('Enter a valid amount.');
    }
    if (amountMinor <= 0) return setError('Enter an amount greater than zero.');

    onSave({ id: uid('s'), date, fromMemberId, toMemberId, amountMinor, note: note || undefined });
  };

  const options = (ids: string[]) =>
    event.members
      .filter((m) => ids.includes(m.id))
      .map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ));

  return (
    <Sheet title="Record a payment" onClose={onClose}>
      <div className="stack">
        {transfer ? (
          <p className="banner banner--info" style={{ margin: 0 }}>
            Anyone in {transfer.fromLabel} can pay this off on the family's behalf.
          </p>
        ) : null}

        <label className="field">
          <span className="field__label">Who paid</span>
          <select
            className="select"
            value={fromMemberId}
            onChange={(e) => setFromMemberId(e.target.value)}
          >
            {options(fromOptions)}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Who received it</span>
          <select
            className="select"
            value={toMemberId}
            onChange={(e) => setToMemberId(e.target.value)}
          >
            {options(toOptions)}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Amount in {event.homeCurrency}</span>
          <input
            className="input input--amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field__label">When</span>
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field__label">Note</span>
          <input
            className="input"
            placeholder="UPI, cash, bank transfer…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        {error ? <p className="banner">{error}</p> : null}

        <button className="btn btn--primary btn--block" onClick={save}>
          Record payment
        </button>
      </div>
    </Sheet>
  );
}
