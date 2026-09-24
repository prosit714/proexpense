import { useMemo, useState } from 'react';
import {
  formatMinor,
  minorDigitsFor,
  parseToMinor,
  splitEqual,
  type ExpenseEvent,
  type ExpenseLine,
} from '../domain/index.js';
import { Field, Money, Sheet, today, uid } from './ui.js';

export function LineEditor({
  event,
  line,
  onSave,
  onDelete,
  onClose,
}: {
  event: ExpenseEvent;
  line: ExpenseLine | null;
  onSave: (line: ExpenseLine) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const homeDigits = minorDigitsFor(event.homeCurrency, event.currencyDigits);

  const [name, setName] = useState(line?.name ?? '');
  const [currency, setCurrency] = useState(line?.currency ?? event.homeCurrency);
  const [amount, setAmount] = useState(() =>
    line ? formatMinor(line.amountMinor, minorDigitsFor(line.currency, event.currencyDigits)) : '',
  );
  const [rate, setRate] = useState(String(line?.rateToHome ?? 1));
  const [payerId, setPayerId] = useState(line?.payerId ?? event.members[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState(line?.categoryId ?? '');
  const [date, setDate] = useState(line?.date ?? today());
  const [participantIds, setParticipantIds] = useState<string[]>(
    line?.participantIds ?? event.members.map((m) => m.id),
  );
  const [error, setError] = useState('');

  const currencies = useMemo(
    () => [...new Set([event.homeCurrency, ...Object.keys(event.rates ?? {}), currency])],
    [event.homeCurrency, event.rates, currency],
  );

  const digits = minorDigitsFor(currency, event.currencyDigits);
  const isForeign = currency !== event.homeCurrency;

  // Live preview of the split, which is where most data-entry mistakes get
  // caught — a per-head figure that looks wrong is obvious in a way that a
  // total is not.
  const preview = useMemo(() => {
    try {
      const minor = parseToMinor(amount, digits);
      if (participantIds.length === 0) return null;
      const homeMinor = isForeign
        ? Math.round(minor * Number(rate) * 10 ** (homeDigits - digits))
        : minor;
      const shares = splitEqual(homeMinor, participantIds);
      return { homeMinor, perHead: Object.values(shares) };
    } catch {
      return null;
    }
  }, [amount, digits, rate, isForeign, participantIds, homeDigits]);

  const toggleParticipant = (id: string) =>
    setParticipantIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  const save = () => {
    setError('');
    if (!name.trim()) return setError('Give the expense a name.');
    if (!payerId) return setError('Choose who paid.');
    if (participantIds.length === 0) return setError('Choose at least one person to split between.');

    let amountMinor: number;
    try {
      amountMinor = parseToMinor(amount, digits);
    } catch {
      return setError(`Enter an amount with at most ${digits} decimal places.`);
    }
    if (amountMinor === 0) return setError('Enter an amount.');

    const rateToHome = isForeign ? Number(rate) : 1;
    if (isForeign && (!Number.isFinite(rateToHome) || rateToHome <= 0)) {
      return setError(`Set how many ${event.homeCurrency} one ${currency} is worth.`);
    }

    onSave({
      id: line?.id ?? uid('l'),
      name: name.trim(),
      date,
      amountMinor,
      currency,
      rateToHome,
      payerId,
      categoryId: categoryId || undefined,
      participantIds,
      split: { mode: 'equal' },
    });
  };

  return (
    <Sheet title={line ? 'Edit expense' : 'Add expense'} onClose={onClose}>
      <div className="stack">
        <Field label="What was it for?">
          <input
            className="input"
            autoFocus={!line}
            placeholder="Dinner at Martin's"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ width: '6.5rem' }}>
            <Field label="Currency">
              <select
                className="select"
                value={currency}
                onChange={(e) => {
                  setCurrency(e.target.value);
                  if (e.target.value !== event.homeCurrency) {
                    setRate(String(event.rates?.[e.target.value] ?? rate));
                  }
                }}
              >
                {currencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grow">
            <Field label="Amount">
              <input
                className="input input--amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
          </div>
        </div>

        {isForeign ? (
          <Field label={`Rate — how many ${event.homeCurrency} is one ${currency}?`}>
            <input
              className="input input--amount"
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </Field>
        ) : null}

        <Field label="Who paid?">
          <select className="select" value={payerId} onChange={(e) => setPayerId(e.target.value)}>
            {event.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Category">
          <select
            className="select"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">No category</option>
            {event.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="field">
          <div className="row row--between">
            <span className="field__label">Split between</span>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() =>
                setParticipantIds(
                  participantIds.length === event.members.length
                    ? []
                    : event.members.map((m) => m.id),
                )
              }
            >
              {participantIds.length === event.members.length ? 'Clear all' : 'Everyone'}
            </button>
          </div>
          <div className="chips">
            {event.members.map((m) => (
              <button
                key={m.id}
                type="button"
                className="chip"
                aria-pressed={participantIds.includes(m.id)}
                onClick={() => toggleParticipant(m.id)}
              >
                {m.name}
              </button>
            ))}
          </div>
        </div>

        <Field label="When">
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>

        {preview ? (
          <p className="banner banner--info" style={{ margin: 0 }}>
            <Money minor={preview.homeMinor} digits={homeDigits} /> {event.homeCurrency} · about{' '}
            <Money minor={preview.perHead[0] ?? 0} digits={homeDigits} /> each across{' '}
            {participantIds.length}
          </p>
        ) : null}

        {error ? <p className="banner">{error}</p> : null}

        <button className="btn btn--primary btn--block" onClick={save}>
          {line ? 'Save changes' : 'Add expense'}
        </button>
        {onDelete ? (
          <button className="btn btn--danger btn--block" onClick={onDelete}>
            Delete expense
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}
