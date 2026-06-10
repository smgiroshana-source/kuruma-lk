// One semantic palette for sale payment-status chips, used everywhere a
// status is shown so color carries consistent meaning across the app:
//   green = paid · amber = partial/pending · red = credit & void · slate = draft
export function saleStatusChip(status: string | null | undefined): { label: string; cls: string } {
  switch (status) {
    case 'paid':    return { label: 'PAID',    cls: 'bg-green-100 text-green-700' }
    case 'partial': return { label: 'PARTIAL', cls: 'bg-amber-100 text-amber-700' }
    case 'credit':  return { label: 'CREDIT',  cls: 'bg-red-100 text-red-600' }
    case 'voided':  return { label: 'VOID',    cls: 'bg-red-100 text-red-600' }
    case 'draft':   return { label: 'DRAFT',   cls: 'bg-slate-200 text-slate-600' }
    default:        return { label: (status || '?').toUpperCase(), cls: 'bg-slate-100 text-slate-500' }
  }
}
