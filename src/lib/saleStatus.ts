// One semantic palette for sale payment-status chips, used everywhere a
// status is shown so color carries consistent meaning across the app:
//   green = paid · amber = partial/pending · red = credit & void · slate = draft
export function saleStatusChip(status: string | null | undefined, sale?: { total?: any; returned_amount?: any } | null): { label: string; cls: string } {
  // A fully returned sale is no longer voided — it keeps the value it sold for
  // so its own month stays put, and the reversal counts in the month the goods
  // came back. Nothing is owed on it, so payment_status settles to 'paid',
  // which on its own would put a green PAID chip on a sale where every part
  // came back. Say what actually happened instead.
  const total = Number(sale?.total) || 0
  if (total > 0 && (Number(sale?.returned_amount) || 0) >= total && status !== 'voided' && status !== 'draft') {
    return { label: 'RETURNED', cls: 'bg-red-100 text-red-600' }
  }
  switch (status) {
    case 'paid':    return { label: 'PAID',    cls: 'bg-green-100 text-green-700' }
    case 'partial': return { label: 'PARTIAL', cls: 'bg-amber-100 text-amber-700' }
    case 'credit':  return { label: 'CREDIT',  cls: 'bg-red-100 text-red-600' }
    case 'voided':  return { label: 'VOID',    cls: 'bg-red-100 text-red-600' }
    case 'draft':   return { label: 'DRAFT',   cls: 'bg-slate-200 text-slate-600' }
    default:        return { label: (status || '?').toUpperCase(), cls: 'bg-slate-100 text-slate-500' }
  }
}
