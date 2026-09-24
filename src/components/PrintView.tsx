import {
  computeBalances,
  formatMinor,
  minorDigitsFor,
  sharesForLine,
  suggestTransfers,
  type ExpenseEvent,
} from '../domain/index.js';
import { formatDay } from './ui.js';

/**
 * The export.
 *
 * This is hidden on screen and revealed only by the print stylesheet, so
 * "Export as PDF" is the browser's own print dialog with "Save as PDF" chosen.
 * That gets a correct, paginated, selectable-text PDF on every platform with no
 * server-side rendering, no PDF library, and nothing to keep patched — and it
 * prints on paper properly as a side effect.
 */
export function PrintView({ event }: { event: ExpenseEvent }) {
  const balances = computeBalances(event);
  const digits = balances.homeDigits;
  const transfers = suggestTransfers(balances);

  const memberName = (id: string) => event.members.find((m) => m.id === id)?.name ?? '—';
  const categoryName = (id?: string) =>
    id ? (event.categories.find((c) => c.id === id)?.name ?? '—') : '—';

  const lines = [...event.lines].sort((a, b) => a.date.localeCompare(b.date));

  const categoryRows = Object.entries(balances.totalsByCategoryMinor).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <div className="print">
      <h1>{event.name}</h1>
      <p className="print__meta">
        {event.status === 'closed' ? 'Closed' : balances.isBalanced ? 'Settled' : 'Unsettled'} ·{' '}
        {event.members.length} people · {event.lines.length} expenses · totals in{' '}
        {event.homeCurrency}
      </p>

      <h2>Expenses</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Expense</th>
            <th>Category</th>
            <th>Paid by</th>
            <th>Split</th>
            <th className="num">Amount</th>
            <th className="num">In {event.homeCurrency}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const lineDigits = minorDigitsFor(line.currency, event.currencyDigits);
            const homeTotal = Object.values(sharesForLine(line, event)).reduce(
              (a, b) => a + b,
              0,
            );
            return (
              <tr key={line.id}>
                <td>{formatDay(line.date)}</td>
                <td>{line.name}</td>
                <td>{categoryName(line.categoryId)}</td>
                <td>{memberName(line.payerId)}</td>
                <td>{line.participantIds.map(memberName).join(', ')}</td>
                <td className="num">
                  {line.currency !== event.homeCurrency
                    ? `${line.currency} ${formatMinor(line.amountMinor, lineDigits)} @ ${line.rateToHome}`
                    : formatMinor(line.amountMinor, lineDigits)}
                </td>
                <td className="num">{formatMinor(homeTotal, digits)}</td>
              </tr>
            );
          })}
          <tr className="print__total">
            <td colSpan={6}>Total</td>
            <td className="num">{formatMinor(balances.totalSpentMinor, digits)}</td>
          </tr>
        </tbody>
      </table>

      {categoryRows.length > 0 ? (
        <>
          <h2>By category</h2>
          <table>
            <tbody>
              {categoryRows.map(([id, total]) => (
                <tr key={id}>
                  <td>{id === 'uncategorised' ? 'Uncategorised' : categoryName(id)}</td>
                  <td className="num">{formatMinor(total, digits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <h2>Per person</h2>
      <table>
        <thead>
          <tr>
            <th>Person</th>
            <th>Settles with</th>
            <th className="num">Paid</th>
            <th className="num">Their share</th>
            <th className="num">Balance</th>
          </tr>
        </thead>
        <tbody>
          {balances.byMember.map((member) => {
            const group = balances.byGroup.find((g) => g.groupId === member.groupId);
            return (
              <tr key={member.memberId}>
                <td>{member.name}</td>
                <td>{group?.isFamily ? group.label : 'Themselves'}</td>
                <td className="num">{formatMinor(member.paidMinor, digits)}</td>
                <td className="num">{formatMinor(member.shareMinor, digits)}</td>
                <td className="num">{formatMinor(member.netMinor, digits)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2>Settlement</h2>
      {event.settlements.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>From</th>
              <th>To</th>
              <th>Note</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {event.settlements.map((settlement) => (
              <tr key={settlement.id}>
                <td>{formatDay(settlement.date)}</td>
                <td>{memberName(settlement.fromMemberId)}</td>
                <td>{memberName(settlement.toMemberId)}</td>
                <td>{settlement.note ?? '—'}</td>
                <td className="num">{formatMinor(settlement.amountMinor, digits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No payments recorded.</p>
      )}

      {transfers.length > 0 ? (
        <>
          <h2>Still outstanding</h2>
          <table>
            <tbody>
              {transfers.map((transfer, index) => (
                <tr key={index}>
                  <td>
                    {transfer.fromLabel} pays {transfer.toLabel}
                  </td>
                  <td className="num">{formatMinor(transfer.amountMinor, digits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <p className="print__stamp">
        ProExpense · generated {new Date().toLocaleString()}
      </p>
    </div>
  );
}
