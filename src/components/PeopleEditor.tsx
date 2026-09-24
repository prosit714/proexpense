import { useState } from 'react';
import type { ExpenseEvent } from '../domain/index.js';
import { Field, uid } from './ui.js';

/**
 * Members, families, categories and rates. All of it is editable at any point
 * in an event's life, not just at creation — you rarely know the full guest
 * list when you start a trip.
 */
export function PeopleEditor({
  event,
  onChange,
}: {
  event: ExpenseEvent;
  onChange: (next: ExpenseEvent) => void;
}) {
  const [memberName, setMemberName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [rateCode, setRateCode] = useState('');
  const [rateValue, setRateValue] = useState('');

  const usedMemberIds = new Set([
    ...event.lines.map((l) => l.payerId),
    ...event.lines.flatMap((l) => l.participantIds),
    ...event.settlements.flatMap((s) => [s.fromMemberId, s.toMemberId]),
  ]);

  const addMember = () => {
    if (!memberName.trim()) return;
    onChange({
      ...event,
      members: [...event.members, { id: uid('m'), name: memberName.trim() }],
    });
    setMemberName('');
  };

  const addFamily = () => {
    if (!familyName.trim()) return;
    onChange({ ...event, families: [...event.families, { id: uid('f'), name: familyName.trim() }] });
    setFamilyName('');
  };

  const addCategory = () => {
    if (!categoryName.trim()) return;
    onChange({
      ...event,
      categories: [...event.categories, { id: uid('c'), name: categoryName.trim() }],
    });
    setCategoryName('');
  };

  const addRate = () => {
    const code = rateCode.trim().toUpperCase();
    const value = Number(rateValue);
    if (code.length !== 3 || !Number.isFinite(value) || value <= 0) return;
    onChange({ ...event, rates: { ...event.rates, [code]: value } });
    setRateCode('');
    setRateValue('');
  };

  return (
    <div className="stack">
      <section className="card">
        <h3>People</h3>
        <p className="faint" style={{ margin: '0.25rem 0 0.75rem' }}>
          Put people in a family and they settle together — one of them can pay off the whole
          family's share.
        </p>
        {event.members.map((member) => (
          <div className="row" key={member.id} style={{ padding: '0.375rem 0' }}>
            <span className="grow truncate">{member.name}</span>
            <select
              className="select"
              style={{ width: 'auto', minHeight: '2.25rem' }}
              value={member.familyId ?? ''}
              onChange={(e) =>
                onChange({
                  ...event,
                  members: event.members.map((m) =>
                    m.id === member.id ? { ...m, familyId: e.target.value || undefined } : m,
                  ),
                })
              }
            >
              <option value="">On their own</option>
              {event.families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <button
              className="btn btn--ghost btn--sm"
              disabled={usedMemberIds.has(member.id)}
              title={
                usedMemberIds.has(member.id)
                  ? 'This person appears on an expense, so they cannot be removed'
                  : 'Remove'
              }
              onClick={() =>
                onChange({ ...event, members: event.members.filter((m) => m.id !== member.id) })
              }
            >
              Remove
            </button>
          </div>
        ))}
        <div className="row" style={{ marginTop: '0.5rem' }}>
          <input
            className="input"
            placeholder="Add someone"
            value={memberName}
            onChange={(e) => setMemberName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addMember()}
          />
          <button className="btn" onClick={addMember}>
            Add
          </button>
        </div>
      </section>

      <section className="card">
        <h3>Families</h3>
        {event.families.length === 0 ? (
          <p className="faint" style={{ margin: '0.25rem 0 0.75rem' }}>
            No families yet. Everyone settles individually.
          </p>
        ) : (
          event.families.map((family) => (
            <div className="row" key={family.id} style={{ padding: '0.375rem 0' }}>
              <span className="grow truncate">{family.name}</span>
              <span className="faint">
                {event.members.filter((m) => m.familyId === family.id).length} people
              </span>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() =>
                  onChange({
                    ...event,
                    families: event.families.filter((f) => f.id !== family.id),
                    members: event.members.map((m) =>
                      m.familyId === family.id ? { ...m, familyId: undefined } : m,
                    ),
                  })
                }
              >
                Remove
              </button>
            </div>
          ))
        )}
        <div className="row" style={{ marginTop: '0.5rem' }}>
          <input
            className="input"
            placeholder="Add a family"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addFamily()}
          />
          <button className="btn" onClick={addFamily}>
            Add
          </button>
        </div>
      </section>

      <section className="card">
        <h3>Categories</h3>
        <div className="chips" style={{ margin: '0.5rem 0' }}>
          {event.categories.map((category) => (
            <button
              key={category.id}
              className="chip"
              title="Remove category"
              onClick={() =>
                onChange({
                  ...event,
                  categories: event.categories.filter((c) => c.id !== category.id),
                  lines: event.lines.map((l) =>
                    l.categoryId === category.id ? { ...l, categoryId: undefined } : l,
                  ),
                })
              }
            >
              {category.name} ✕
            </button>
          ))}
        </div>
        <div className="row">
          <input
            className="input"
            placeholder="Food, travel, stay…"
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCategory()}
          />
          <button className="btn" onClick={addCategory}>
            Add
          </button>
        </div>
      </section>

      <section className="card">
        <h3>Exchange rates</h3>
        <p className="faint" style={{ margin: '0.25rem 0 0.75rem' }}>
          These prefill the rate when you add an expense. Changing one here does not touch expenses
          you have already entered.
        </p>
        {Object.entries(event.rates ?? {}).map(([code, value]) => (
          <div className="row" key={code} style={{ padding: '0.375rem 0' }}>
            <span className="grow">
              1 {code} = <span className="money">{value}</span> {event.homeCurrency}
            </span>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => {
                const next = { ...event.rates };
                delete next[code];
                onChange({ ...event, rates: next });
              }}
            >
              Remove
            </button>
          </div>
        ))}
        <div className="row" style={{ marginTop: '0.5rem', alignItems: 'flex-end' }}>
          <div style={{ width: '6rem' }}>
            <Field label="Currency">
              <input
                className="input"
                placeholder="USD"
                maxLength={3}
                value={rateCode}
                onChange={(e) => setRateCode(e.target.value.toUpperCase())}
              />
            </Field>
          </div>
          <div className="grow">
            <Field label={`Worth in ${event.homeCurrency}`}>
              <input
                className="input input--amount"
                inputMode="decimal"
                placeholder="83.25"
                value={rateValue}
                onChange={(e) => setRateValue(e.target.value)}
              />
            </Field>
          </div>
          <button className="btn" onClick={addRate}>
            Add
          </button>
        </div>
      </section>
    </div>
  );
}
