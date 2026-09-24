import { useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import { Field } from './ui.js';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

function PinPad({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled) return;
      if (/^\d$/.test(e.key)) onChange((value + e.key).slice(0, 6));
      else if (e.key === 'Backspace') onChange(value.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [value, onChange, disabled]);

  return (
    <div className="pin__grid">
      {KEYS.map((key, index) =>
        key === '' ? (
          <span className="pin__key pin__key--blank" key={index} />
        ) : (
          <button
            key={index}
            type="button"
            className="pin__key"
            disabled={disabled}
            aria-label={key === '⌫' ? 'Delete last digit' : key}
            onClick={() =>
              onChange(key === '⌫' ? value.slice(0, -1) : (value + key).slice(0, 6))
            }
          >
            {key}
          </button>
        ),
      )}
    </div>
  );
}

function Dots({ filled, error }: { filled: number; error: boolean }) {
  return (
    <div className={`pin__dots${error ? ' shake' : ''}`} aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`pin__dot${i < filled ? (error ? ' pin__dot--error' : ' pin__dot--filled') : ''}`}
        />
      ))}
    </div>
  );
}

export function PinLogin({ onSignedIn }: { onSignedIn: (mustChangePin: boolean) => void }) {
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lockedFor, setLockedFor] = useState(0);

  useEffect(() => {
    if (lockedFor <= 0) return;
    const timer = setInterval(() => setLockedFor((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [lockedFor]);

  useEffect(() => {
    if (pin.length !== 6 || busy || lockedFor > 0) return;
    let cancelled = false;
    setBusy(true);
    api
      .login(pin)
      .then((result) => {
        if (!cancelled) onSignedIn(result.mustChangePin);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const seconds =
          err instanceof ApiError && typeof err.detail?.retryAfterSeconds === 'number'
            ? err.detail.retryAfterSeconds
            : 0;
        setMessage(err instanceof ApiError ? err.message : 'Could not reach the server');
        setError(true);
        setLockedFor(seconds);
        setPin('');
        setTimeout(() => setError(false), 400);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pin, busy, lockedFor, onSignedIn]);

  return (
    <div className="pin">
      <div style={{ textAlign: 'center' }}>
        <div className="pin__wordmark">ProExpense</div>
        <p className="muted" style={{ margin: '0.25rem 0 0' }}>
          {lockedFor > 0 ? `Locked for ${lockedFor}s` : 'Enter your six digit PIN'}
        </p>
      </div>
      <Dots filled={pin.length} error={error} />
      <p className="pin__message" role="status">
        {message}
      </p>
      <PinPad value={pin} onChange={setPin} disabled={busy || lockedFor > 0} />
    </div>
  );
}

export function ChangePin({
  forced,
  onDone,
  onCancel,
}: {
  forced: boolean;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [currentPin, setCurrentPin] = useState(forced ? '000000' : '');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setMessage('');
    if (newPin !== confirmPin) {
      setMessage('The two new PINs do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.changePin(currentPin, newPin);
      onDone();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not reach the server');
    } finally {
      setBusy(false);
    }
  };

  const digitsOnly = (value: string) => value.replace(/\D/g, '').slice(0, 6);
  const ready = /^\d{6}$/.test(currentPin) && /^\d{6}$/.test(newPin) && !busy;

  return (
    <div className="stack" style={{ maxWidth: '22rem', margin: '0 auto', paddingTop: '2rem' }}>
      <h1>{forced ? 'Set your PIN' : 'Change your PIN'}</h1>
      <p className="muted" style={{ margin: 0 }}>
        {forced
          ? 'This app ships with the PIN 000000. Pick your own before going any further — everything else stays locked until you do.'
          : 'Changing your PIN signs out every other device.'}
      </p>

      <Field label={forced ? 'Current PIN' : 'Current PIN'}>
        <input
          className="input input--amount"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          value={currentPin}
          onChange={(e) => setCurrentPin(digitsOnly(e.target.value))}
        />
      </Field>
      <Field label="New PIN">
        <input
          className="input input--amount"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          value={newPin}
          onChange={(e) => setNewPin(digitsOnly(e.target.value))}
        />
      </Field>
      <Field label="New PIN again" error={message || undefined}>
        <input
          className="input input--amount"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          value={confirmPin}
          onChange={(e) => setConfirmPin(digitsOnly(e.target.value))}
        />
      </Field>

      <button className="btn btn--primary btn--block" disabled={!ready} onClick={submit}>
        {busy ? 'Saving…' : 'Save PIN'}
      </button>
      {onCancel ? (
        <button className="btn btn--ghost btn--block" onClick={onCancel}>
          Cancel
        </button>
      ) : null}
    </div>
  );
}
