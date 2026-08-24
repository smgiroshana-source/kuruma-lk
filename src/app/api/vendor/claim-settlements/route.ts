import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recomputeSessionForDate } from '@/lib/cash'

// ─────────────────────────────────────────────────────────────────────────────
// Insurance claims — stage 2: settlements and shortfall classification.
//
// record_settlement  the discharge voucher: money allocated across the claim's
//                    documents. Sale lines become payment rows; bill lines
//                    increase reimbursed_amount. VAT-incl/excl is stated by
//                    the operator, never inferred — ex-VAT figures gross up
//                    per line using the ORIGINAL invoice's own VAT ratio.
//                    Every remaining short document gets an open, unclassified
//                    shortfall row.
//
// classify           CR   → credit note to insurer; re-invoice attached later
//                    WD   → credit note; VAT + SSCL reduce  (owner/manager)
//                    DISC → same as WD + reason code        (owner/manager)
//                    DEBT → no documents; stays receivable
//                    RECOVER / ABSORB → third-party bills, money-only
//
// The credit note carries the original invoice's VAT ratio (sale.vat_amount /
// sale.net_amount), never today's rate, and splits its lines across the
// sale's PART/SVC streams pro-rata so SSCL turnover reduces on the right base.
//
// HARD BLOCK (enforced here and in the receivables flow): once WD or DISC is
// on a sale, no further receipt can land on it — reducing output tax while
// still collecting is the audit pattern this exists to prevent. Undoing means
// reclassification with the credit note trail intact, not a quiet receipt.
// ─────────────────────────────────────────────────────────────────────────────

async function getCaller() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return { vendor, role: 'owner', email: user.email || '' }
  const { data: s } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (s?.vendor) return { vendor: s.vendor, role: s.role || 'cashier', email: user.email || '' }
  return null
}

const r0 = (n: any) => Math.round(Number(n) || 0)

// The original invoice's own VAT ratio — the rate it was actually issued at.
function saleVatParts(sale: any, grossAmount: number) {
  const net = Number(sale.net_amount || 0)
  const vat = Number(sale.vat_amount || 0)
  if (net <= 0 || vat < 0) return { net: grossAmount, vat: 0, rate: 0 }
  const rate = (vat / net) * 100
  const vatPart = Math.round(grossAmount * vat / (net + vat))
  return { net: grossAmount - vatPart, vat: vatPart, rate: Math.round(rate * 100) / 100 }
}

export async function POST(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({} as any))
  const { action } = body

  // ═══ RECORD A SETTLEMENT (discharge voucher) ═══════════════════════════════
  if (action === 'record_settlement') {
    const { claimId, receivedDate, voucherRef, vatInclusive, paymentMethod, bankRef, lines, notes } = body

    if (typeof vatInclusive !== 'boolean') {
      return NextResponse.json({ error: 'State whether the voucher figures include VAT — this is never assumed' }, { status: 400 })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(receivedDate || ''))) {
      return NextResponse.json({ error: 'receivedDate must be YYYY-MM-DD' }, { status: 400 })
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ error: 'Allocate the payment to at least one document' }, { status: 400 })
    }

    const { data: claim } = await admin.from('insurance_claims')
      .select('id, status, claim_no').eq('id', claimId).eq('vendor_id', caller.vendor.id).single()
    if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 })

    const saleIds = lines.filter((l: any) => l.saleId).map((l: any) => l.saleId)
    const billIds = lines.filter((l: any) => l.billId).map((l: any) => l.billId)

    const { data: sales } = saleIds.length
      ? await admin.from('sales').select('*').in('id', saleIds).eq('claim_id', claimId).eq('vendor_id', caller.vendor.id)
      : { data: [] as any[] }
    const { data: bills } = billIds.length
      ? await admin.from('claim_third_party_bills').select('*').in('id', billIds).eq('claim_id', claimId)
      : { data: [] as any[] }

    // The hard block: a WD/DISC sale takes no more money, from anyone.
    const { data: blocked } = saleIds.length
      ? await admin.from('claim_shortfalls').select('sale_id, classification')
          .eq('claim_id', claimId).in('sale_id', saleIds).in('classification', ['WD', 'DISC'])
      : { data: [] as any[] }
    if ((blocked || []).length > 0) {
      const which = (sales || []).filter((s: any) => (blocked || []).some((b: any) => b.sale_id === s.id))
        .map((s: any) => s.tax_serial || s.invoice_no).join(', ')
      return NextResponse.json({
        error: `Blocked: ${which} was written down / discounted — its output VAT was already reduced, so no further receipt may be recorded on it. Reclassify the shortfall first.`,
      }, { status: 400 })
    }

    // Validate + convert lines to VAT-inclusive rupees against our invoices
    const prepared: any[] = []
    for (const l of lines) {
      const entered = r0(l.amount)
      if (entered <= 0) continue
      if (l.saleId) {
        const sale = (sales || []).find((s: any) => s.id === l.saleId)
        if (!sale) return NextResponse.json({ error: 'A settlement line targets an invoice that is not on this claim' }, { status: 400 })
        if (sale.payment_status === 'voided') return NextResponse.json({ error: `${sale.tax_serial || sale.invoice_no} is VOID` }, { status: 400 })
        // Ex-VAT voucher: gross up with the invoice's OWN ratio
        const inclusive = vatInclusive ? entered
          : entered + Math.round(entered * Number(sale.vat_amount || 0) / Math.max(1, Number(sale.net_amount || 0)))
        const balance = r0(sale.balance_due)
        if (inclusive > balance) {
          return NextResponse.json({
            error: `${sale.tax_serial || sale.invoice_no}: allocation Rs.${inclusive.toLocaleString()} exceeds its balance Rs.${balance.toLocaleString()}${!vatInclusive ? ' (after adding VAT to the ex-VAT figure)' : ''}`,
          }, { status: 400 })
        }
        prepared.push({ kind: 'sale', target: sale, entered, inclusive, method: l.allocationMethod || 'direct' })
      } else if (l.billId) {
        const bill = (bills || []).find((b: any) => b.id === l.billId)
        if (!bill) return NextResponse.json({ error: 'A settlement line targets a bill that is not on this claim' }, { status: 400 })
        // Pass-through bills: the vendor's figure IS the figure — no VAT maths, ever.
        const room = r0(bill.bill_amount) - r0(bill.reimbursed_amount)
        if (entered > room) {
          return NextResponse.json({ error: `${bill.supplier_name}'s bill: allocation exceeds its unreimbursed Rs.${room.toLocaleString()}` }, { status: 400 })
        }
        prepared.push({ kind: 'bill', target: bill, entered, inclusive: entered, method: l.allocationMethod || 'direct' })
      }
    }
    if (prepared.length === 0) return NextResponse.json({ error: 'No usable settlement lines' }, { status: 400 })

    const gross = prepared.reduce((t, p) => t + p.inclusive, 0)
    const method = ['bank', 'cheque', 'cash'].includes(paymentMethod) ? paymentMethod : 'bank'

    const { data: settlement, error: setErr } = await admin.from('claim_settlements').insert({
      claim_id: claimId, vendor_id: caller.vendor.id,
      received_date: receivedDate, voucher_ref: voucherRef?.trim() || null,
      vat_inclusive: vatInclusive, payment_method: method, bank_ref: bankRef?.trim() || null,
      gross_amount: gross, notes: notes?.trim() || null, created_by: caller.email,
    }).select().single()
    if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 })

    const applied: string[] = []
    for (const p of prepared) {
      await admin.from('claim_settlement_lines').insert({
        settlement_id: settlement.id, claim_id: claimId,
        sale_id: p.kind === 'sale' ? p.target.id : null,
        bill_id: p.kind === 'bill' ? p.target.id : null,
        entered_amount: p.entered, amount: p.inclusive, allocation_method: p.method,
      })
      if (p.kind === 'sale') {
        await admin.from('payments').insert({
          sale_id: p.target.id, vendor_id: caller.vendor.id, customer_id: p.target.customer_id,
          amount: p.inclusive, payment_method: method,
          bank_ref: bankRef?.trim() || null,
          notes: `Insurer settlement${voucherRef ? ' ' + voucherRef : ''} — claim ${claim.claim_no || ''}`.trim(),
        })
        const newPaid = r0(p.target.paid_amount) + p.inclusive
        const newBalance = Math.max(0, r0(p.target.balance_due) - p.inclusive)
        await admin.from('sales').update({
          paid_amount: newPaid, balance_due: newBalance,
          payment_status: newBalance === 0 ? 'paid' : 'partial',
        }).eq('id', p.target.id)
        applied.push(`${p.target.tax_serial || p.target.invoice_no}: Rs.${p.inclusive.toLocaleString()}`)
      } else {
        await admin.from('claim_third_party_bills').update({
          reimbursed_amount: r0(p.target.reimbursed_amount) + p.inclusive,
        }).eq('id', p.target.id)
        applied.push(`${p.target.supplier_name}: Rs.${p.inclusive.toLocaleString()}`)
      }
    }
    if (method === 'cash') await recomputeSessionForDate(admin, caller.vendor.id, receivedDate)

    // Whatever is STILL short now becomes an open shortfall to classify.
    const { data: claimSales } = await admin.from('sales').select('id, balance_due, payment_status')
      .eq('claim_id', claimId).eq('vendor_id', caller.vendor.id).neq('payment_status', 'voided')
    let shortfalls = 0
    for (const s of (claimSales || [])) {
      const bal = r0(s.balance_due)
      if (bal > 0) {
        await admin.from('claim_shortfalls').upsert({
          claim_id: claimId, vendor_id: caller.vendor.id, sale_id: s.id,
          amount: bal, updated_at: new Date().toISOString(),
        }, { onConflict: 'claim_id,sale_id' })
        shortfalls++
      } else {
        await admin.from('claim_shortfalls').delete()
          .eq('claim_id', claimId).eq('sale_id', s.id).is('classification', null)
      }
    }
    const { data: claimBills } = await admin.from('claim_third_party_bills').select('*').eq('claim_id', claimId)
    for (const b of (claimBills || [])) {
      const shortBy = r0(b.bill_amount) - r0(b.reimbursed_amount)
      if (shortBy > 0 && b.fronted) {
        await admin.from('claim_shortfalls').upsert({
          claim_id: claimId, vendor_id: caller.vendor.id, bill_id: b.id,
          amount: shortBy, updated_at: new Date().toISOString(),
        }, { onConflict: 'claim_id,bill_id' })
        shortfalls++
      } else {
        await admin.from('claim_shortfalls').delete()
          .eq('claim_id', claimId).eq('bill_id', b.id).is('classification', null)
      }
    }

    await admin.from('insurance_claims').update({
      status: shortfalls > 0 ? 'settling' : 'closed', updated_at: new Date().toISOString(),
    }).eq('id', claimId)

    return NextResponse.json({
      ok: true,
      message: `Settlement Rs.${gross.toLocaleString()} applied — ${applied.join(' · ')}${shortfalls ? ` · ${shortfalls} shortfall${shortfalls > 1 ? 's' : ''} to classify` : ' · claim fully settled'}`,
      shortfalls,
    })
  }

  // ═══ CLASSIFY A SHORTFALL ══════════════════════════════════════════════════
  if (action === 'classify') {
    const { shortfallId, classification, reasonCode, reasonText } = body
    const { data: sf } = await admin.from('claim_shortfalls')
      .select('*, claim:insurance_claims(id, claim_no, insurer_customer_id)')
      .eq('id', shortfallId).eq('vendor_id', caller.vendor.id).single()
    if (!sf) return NextResponse.json({ error: 'Shortfall not found' }, { status: 404 })
    if (sf.status !== 'open') return NextResponse.json({ error: `Already ${sf.status} — reclassification unwinds are owner territory, ask them` }, { status: 400 })

    const isBill = !!sf.bill_id
    const allowed = isBill ? ['RECOVER', 'ABSORB'] : ['CR', 'WD', 'DISC', 'DEBT']
    if (!allowed.includes(classification)) {
      return NextResponse.json({ error: `A ${isBill ? 'pass-through bill' : 'sale'} shortfall must be one of: ${allowed.join(', ')}` }, { status: 400 })
    }

    // Approval gates (owner decision 2026-08-24): WD and DISC need owner or manager.
    if (['WD', 'DISC'].includes(classification) && !['owner', 'manager'].includes(caller.role)) {
      return NextResponse.json({ error: 'Write-downs and discounts need the owner or a branch manager' }, { status: 403 })
    }
    if (classification === 'DISC' && !String(reasonCode || '').trim()) {
      return NextResponse.json({ error: 'A discount needs a reason code' }, { status: 400 })
    }

    // ── Third-party bills: a money decision, never a tax document ──
    if (isBill) {
      await admin.from('claim_shortfalls').update({
        classification, reason_text: reasonText?.trim() || null,
        approved_by: caller.email, approved_at: new Date().toISOString(),
        status: 'actioned', updated_at: new Date().toISOString(),
      }).eq('id', sf.id)
      return NextResponse.json({
        ok: true,
        message: classification === 'RECOVER'
          ? 'Marked to recover from the vehicle owner — no tax documents (it was never our invoice)'
          : 'Absorbed as a loss on the job — no tax documents',
      })
    }

    // ── Our sale: DEBT changes nothing, the rest produce a credit note ──
    const { data: sale } = await admin.from('sales').select('*, items:sale_items(*)')
      .eq('id', sf.sale_id).eq('vendor_id', caller.vendor.id).single()
    if (!sale) return NextResponse.json({ error: 'Original sale not found' }, { status: 404 })

    if (classification === 'DEBT') {
      await admin.from('claim_shortfalls').update({
        classification, reason_text: reasonText?.trim() || null,
        approved_by: caller.email, approved_at: new Date().toISOString(),
        status: 'actioned', updated_at: new Date().toISOString(),
      }).eq('id', sf.id)
      return NextResponse.json({ ok: true, message: 'Kept as a receivable — still chasing, VAT unchanged. Relief only on an actual write-off.' })
    }

    // CR / WD / DISC → credit note from the SALE's entity, at the SALE's rate.
    if (!sale.tax_serial) {
      return NextResponse.json({ error: 'This invoice has no gazette serial — a receipt shortfall needs no credit note; use DEBT or settle it directly' }, { status: 400 })
    }
    const amount = Math.min(r0(sf.amount), r0(sale.balance_due))
    if (amount <= 0) return NextResponse.json({ error: 'Nothing left to credit — the balance is already settled' }, { status: 400 })

    const { net, vat, rate } = saleVatParts(sale, amount)

    // Split the credited value across the sale's PART/SVC streams pro-rata so
    // SSCL turnover reduces on the right base for each.
    const streamTotals: Record<string, number> = {}
    for (const it of (sale.items || [])) {
      const st = it.sscl_stream || 'PART'
      streamTotals[st] = (streamTotals[st] || 0) + Number(it.total || 0)
    }
    const saleLineTotal = Object.values(streamTotals).reduce((a, b) => a + b, 0) || 1
    const cnLines: any[] = []
    let allocated = 0
    const streams = Object.entries(streamTotals)
    streams.forEach(([st, val], i) => {
      const share = i === streams.length - 1 ? amount - allocated : Math.round(amount * val / saleLineTotal)
      allocated += share
      if (share > 0) cnLines.push({
        product_name: `Insurance settlement ${classification === 'CR' ? 'shortfall — recoverable from vehicle owner' : classification === 'WD' ? 'write-down' : 'discount'} (claim ${sf.claim?.claim_no || '—'})`,
        quantity: 1, unit_price: share, total: share, sscl_stream: st,
      })
    })

    const { data: seqNum, error: seqError } = await admin.rpc('next_invoice_serial', {
      p_entity_id: sale.invoice_entity_id, p_period: 'credit',
    })
    if (seqError || seqNum == null) return NextResponse.json({ error: 'Credit note numbering failed: ' + (seqError?.message || 'null') }, { status: 500 })
    const creditNoteNo = `CRN-${String(seqNum).padStart(5, '0')}`

    const { data: cn, error: cnErr } = await admin.from('credit_notes').insert({
      vendor_id: caller.vendor.id, invoice_entity_id: sale.invoice_entity_id,
      original_sale_id: sale.id, original_serial: sale.tax_serial,
      credit_note_no: creditNoteNo,
      reason: classification === 'CR' ? 'settlement_customer_recoverable'
            : classification === 'WD' ? 'settlement_write_down' : 'settlement_discount',
      customer_name: sale.customer_name, customer_address: sale.customer_address,
      customer_tin: sale.customer_tin,
      net_amount: net, vat_amount: vat, total: amount,
      vat_rate: rate, claim_id: sf.claim_id, classification,
      approved_by: caller.email,
    }).select().single()
    if (cnErr) return NextResponse.json({ error: cnErr.message }, { status: 500 })
    const { error: cnItemsErr } = await admin.from('credit_note_items')
      .insert(cnLines.map(l => ({ ...l, credit_note_id: cn.id })))
    if (cnItemsErr) {
      await admin.from('credit_notes').delete().eq('id', cn.id)
      return NextResponse.json({ error: cnItemsErr.message }, { status: 500 })
    }

    // The insurer no longer owes the credited amount. Gazette totals stay
    // immutable — returned_amount carries the reduction for net-of reporting.
    await admin.from('sales').update({
      balance_due: Math.max(0, r0(sale.balance_due) - amount),
      returned_amount: r0(sale.returned_amount) + amount,
      payment_status: Math.max(0, r0(sale.balance_due) - amount) === 0 ? 'paid' : 'partial',
    }).eq('id', sale.id)

    await admin.from('claim_shortfalls').update({
      classification, reason_code: reasonCode?.trim() || null, reason_text: reasonText?.trim() || null,
      approved_by: caller.email, approved_at: new Date().toISOString(),
      credit_note_id: cn.id, status: 'actioned', updated_at: new Date().toISOString(),
    }).eq('id', sf.id)

    const tail = classification === 'CR'
      ? ` Now raise the owner's invoice at the POS (same entity, Rs.${amount.toLocaleString()}) and attach it here.`
      : classification === 'WD'
        ? ` Output VAT reduces by Rs.${vat.toLocaleString()} this period. No further receipts can land on ${sale.tax_serial}.`
        : ` Output VAT reduces by Rs.${vat.toLocaleString()}. No further receipts can land on ${sale.tax_serial}.`
    return NextResponse.json({ ok: true, message: `${creditNoteNo} issued for Rs.${amount.toLocaleString()} (VAT Rs.${vat.toLocaleString()} @ ${rate}%).${tail}` })
  }

  // ═══ ATTACH THE CR RE-INVOICE ══════════════════════════════════════════════
  if (action === 'attach_reinvoice') {
    const { shortfallId, invoiceNo } = body
    const { data: sf } = await admin.from('claim_shortfalls')
      .select('id, classification, amount, claim_id').eq('id', shortfallId).eq('vendor_id', caller.vendor.id).single()
    if (!sf) return NextResponse.json({ error: 'Shortfall not found' }, { status: 404 })
    if (sf.classification !== 'CR') return NextResponse.json({ error: 'Only a customer-recoverable shortfall takes a re-invoice' }, { status: 400 })
    const needle = String(invoiceNo || '').trim()
    const { data: sale } = await admin.from('sales')
      .select('id, invoice_no, tax_serial, total, payment_status')
      .eq('vendor_id', caller.vendor.id)
      .or(`invoice_no.eq.${needle},tax_serial.eq.${needle},receipt_no.eq.${needle}`)
      .maybeSingle()
    if (!sale) return NextResponse.json({ error: 'No invoice found with that number' }, { status: 404 })
    if (sale.payment_status === 'voided') return NextResponse.json({ error: 'That invoice is VOID' }, { status: 400 })
    let warning: string | null = null
    if (r0(sale.total) !== r0(sf.amount)) {
      warning = `Re-invoice is Rs.${r0(sale.total).toLocaleString()} but the credited shortfall was Rs.${r0(sf.amount).toLocaleString()} — net turnover shifts by the difference`
    }
    await admin.from('claim_shortfalls').update({
      reinvoice_sale_id: sale.id, updated_at: new Date().toISOString(),
    }).eq('id', sf.id)
    return NextResponse.json({ ok: true, message: `Re-invoice ${sale.tax_serial || sale.invoice_no} attached${warning ? ' — ⚠️ ' + warning : ''}` })
  }

  // ═══ BAD-DEBT WRITE-OFF (owner only) + RECOVERY ════════════════════════════
  if (action === 'write_off') {
    if (caller.role !== 'owner') return NextResponse.json({ error: 'Bad-debt write-offs are owner-only' }, { status: 403 })
    const { shortfallId, reasonText } = body
    const { data: sf } = await admin.from('claim_shortfalls')
      .select('id, classification, status, amount').eq('id', shortfallId).eq('vendor_id', caller.vendor.id).single()
    if (!sf) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (sf.classification !== 'DEBT' || sf.status !== 'actioned') {
      return NextResponse.json({ error: 'Only a DEBT shortfall still being chased can be written off' }, { status: 400 })
    }
    await admin.from('claim_shortfalls').update({
      status: 'written_off', written_off_at: new Date().toISOString(),
      reason_text: reasonText?.trim() || null, updated_at: new Date().toISOString(),
    }).eq('id', sf.id)
    return NextResponse.json({ ok: true, message: `Written off Rs.${r0(sf.amount).toLocaleString()} — bad-debt VAT relief and SSCL exclusion apply to THIS period's returns, and reverse if it is ever recovered.` })
  }

  if (action === 'record_recovery') {
    if (caller.role !== 'owner') return NextResponse.json({ error: 'Recovery reversal is owner-only' }, { status: 403 })
    const { shortfallId } = body
    const { data: sf } = await admin.from('claim_shortfalls')
      .select('id, status, amount').eq('id', shortfallId).eq('vendor_id', caller.vendor.id).single()
    if (!sf) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (sf.status !== 'written_off') return NextResponse.json({ error: 'Only a written-off debt can be recovered' }, { status: 400 })
    await admin.from('claim_shortfalls').update({
      status: 'recovered', recovered_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', sf.id)
    return NextResponse.json({ ok: true, message: `Recovery recorded — the earlier VAT relief and SSCL exclusion reverse in THIS period. Record the money itself as a receipt on the invoice.` })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
