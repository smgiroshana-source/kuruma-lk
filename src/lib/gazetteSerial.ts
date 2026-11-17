// ── A supplier's tax invoice number, as the gazette prints it (2026-11-17) ───
// Gazette Extraordinary No. 2481/22 (from 1 July 2026): a tax invoice serial is
// YYMMM_QQQQ_XXXXX — 2-digit year, 3-letter month in capitals, the issuer's
// 1–15 character code, a numeric running number; underscores, no spaces, at
// most 40 characters. IRD matches our Schedule 02 against the supplier's own
// return by TIN + this number, so it must be copied exactly.
//
// Staff had been typing it short: Prime Lanka's 26OCT_PLTV_00170 went in as
// "PLTV-00170", and the same supplier four ways ("PLTV 00097", "PLTV- 00129").
// A supplier that still prints an older style can be accepted with an explicit
// "the paper prints it this way" — never silently.

export const GAZETTE_SERIAL_FROM = '2026-07-01'
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const SERIAL = /^(\d{2})([A-Z]{3})_([A-Za-z0-9]{1,15})_(\d+)$/

/** '2026-10-30' → '26OCT' (null when the date can't be read). */
export function expectedSerialPrefix(invoiceDate: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(String(invoiceDate || ''))
  if (!m) return null
  const mon = MONTHS[Number(m[2]) - 1]
  return mon ? m[1].slice(2) + mon : null
}

/**
 * Why this invoice number is not in the gazette format for its date, or null
 * when it is (or when there is nothing to check: no number, no date, or an
 * invoice dated before the format applied).
 */
export function supplierInvoiceNoIssue(no: string | null | undefined, invoiceDate: string | null | undefined): string | null {
  const raw = String(no || '')
  const v = raw.trim()
  if (!v) return null
  const date = String(invoiceDate || '').slice(0, 10)
  if (!date || date < GAZETTE_SERIAL_FROM) return null
  const prefix = expectedSerialPrefix(date)
  const example = `${prefix || 'YYMMM'}_CODE_00000`
  if (/\s/.test(raw.replace(/^\s+|\s+$/g, ''))) return `No spaces in a tax invoice number — copy it exactly as printed, like ${example}.`
  if (v.length > 40) return 'Longer than 40 characters — a tax invoice number is at most 40.'
  const m = SERIAL.exec(v)
  if (!m) {
    if (SERIAL.test(v.toUpperCase())) return `The month must be in capitals, like ${example}.`
    return `Not in the tax invoice format — an invoice dated ${date} reads like ${example} (year, month, the supplier's code and number, joined by _). Copy it exactly as printed.`
  }
  if (prefix && m[1] + m[2] !== prefix) {
    return `Starts ${m[1]}${m[2]} but the invoice is dated ${date} — it should start ${prefix}_. Check the number and the date on the paper.`
  }
  return null
}
