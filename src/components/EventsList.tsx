import { useEffect, useState } from 'react';
import { api, type EventSummary } from '../api.js';
import { Field, Money, Sheet } from './ui.js';

export function EventsList({
  onOpen,
  onChangePin,
  onSignOut,
}: {
  onOpen: (id: string) => void;
  onChangePin: () => void;
  onSignOut: () => void;
}) {
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const load = () => {
    api
      .listEvents()
      .then((r) => setEvents(r.events))
      .catch(() => setError('Could not load your events. Check your connection and try again.'));
  };

  useEffect(load, []);

  return (
    <div className="shell">
      <div className="topbar">
        <div className="topbar__title">
          <h1>ProExpense</h1>
          <div className="topbar__sub">
            {events ? `${events.length} event${events.length === 1 ? '' : 's'}` : 'Loading…'}
          </div>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={onChangePin}>
          PIN
        </button>
        <button className="btn btn--ghost btn--sm" onClick={onSignOut}>
          Sign out
        </button>
      </div>

      {error ? (
        <div className="stack">
          <p className="banner">{error}</p>
        </div>
      ) : null}

      {events && events.length === 0 ? (
        <div className="empty">
          <h2>No events yet</h2>
          <p>Start one for your next trip or dinner, then add who is coming.</p>
        </div>
      ) : null}

      {events && events.length > 0 ? (
        <div className="stack">
          <div className="card card--flush">
            {events.map((event) => (
              <button className="listitem" key={event.id} onClick={() => onOpen(event.id)}>
                <span className="grow">
                  <span className="row" style={{ gap: '0.5rem' }}>
                    <strong className="truncate">{event.name}</strong>
                    {event.status === 'closed' ? <span className="pill pill--closed">Closed</span> : null}
                  </span>
                  <span className="faint">
                    {event.lineCount} line{event.lineCount === 1 ? '' : 's'} · {event.memberCount} people
                  </span>
                </span>
                <span style={{ textAlign: 'right' }}>
                  <Money minor={event.totalSpentMinor} digits={event.homeDigits} />
                  <span
                    className="faint"
                    style={{
                      display: 'block',
                      color: event.isBalanced ? 'var(--credit)' : 'var(--debt)',
                    }}
                  >
                    {event.isBalanced ? '✓ settled' : '✕ unsettled'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <button className="btn btn--primary fab" onClick={() => setCreating(true)}>
        New event
      </button>

      {creating ? (
        <CreateEvent
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            onOpen(id);
          }}
        />
      ) : null}
    </div>
  );
}

function CreateEvent({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const { event } = await api.createEvent(name.trim(), currency.trim().toUpperCase());
      onCreated(event.id);
    } catch {
      setError('Could not create the event. Try again.');
      setBusy(false);
    }
  };

  return (
    <Sheet title="New event" onClose={onCancel}>
      <div className="stack">
        <Field label="What is it?">
          <input
            className="input"
            autoFocus
            placeholder="Goa trip"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field
          label="Currency you settle in"
          error={error || undefined}
        >
          <input
            className="input"
            value={currency}
            maxLength={3}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </Field>
        <p className="faint" style={{ margin: 0 }}>
          Spending in other currencies is fine — you set the rate per expense.
        </p>
        <button
          className="btn btn--primary btn--block"
          disabled={!name.trim() || currency.length !== 3 || busy}
          onClick={create}
        >
          {busy ? 'Creating…' : 'Create event'}
        </button>
      </div>
    </Sheet>
  );
}
