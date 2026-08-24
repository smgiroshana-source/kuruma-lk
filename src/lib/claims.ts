// Linking a sale to its insurance claim — shared by the POS sale flow and the
// workshop invoice API so both invoices of one repair land on the same claim
// row however they were raised.
//
// Best-effort by design: a claim-linking hiccup must never kill a sale whose
// gazette serial is already minted. Callers surface `warning` to the operator
// instead of failing.

export interface ClaimLinkResult {
  claimId: string | null
  created: boolean
  warning: string | null
}

/** Find the insurer's claim (case-insensitive claim number) or create it, then
 *  point the sale at it. Also backfills vehicle/job ref on the claim when the
 *  sale knows them and the claim doesn't. */
export async function linkSaleToClaim(
  admin: any,
  vendorId: string,
  saleId: string,
  insurerCustomerId: string,
  claimNoRaw: string,
  extras?: { vehicleNo?: string | null; jobRef?: string | null; createdBy?: string | null },
): Promise<ClaimLinkResult> {
  const claimNo = String(claimNoRaw || '').trim()
  if (!claimNo) return { claimId: null, created: false, warning: null }

  try {
    // The insurer must actually be an insurer — a claim against a walk-in
    // customer is a typo, not a claim.
    const { data: insurer } = await admin.from('customers')
      .select('id, is_insurance').eq('id', insurerCustomerId).eq('vendor_id', vendorId).single()
    if (!insurer?.is_insurance) {
      return { claimId: null, created: false, warning: 'Claim number ignored — the customer is not marked as an insurance company' }
    }

    const { data: existing } = await admin.from('insurance_claims')
      .select('id, vehicle_no, workshop_job_ref')
      .eq('vendor_id', vendorId).eq('insurer_customer_id', insurerCustomerId)
      .ilike('claim_no', claimNo)
      .maybeSingle()

    let claimId: string
    let created = false
    if (existing) {
      claimId = existing.id
      const patch: any = {}
      if (!existing.vehicle_no && extras?.vehicleNo) patch.vehicle_no = extras.vehicleNo
      if (!existing.workshop_job_ref && extras?.jobRef) patch.workshop_job_ref = extras.jobRef
      if (Object.keys(patch).length) {
        patch.updated_at = new Date().toISOString()
        await admin.from('insurance_claims').update(patch).eq('id', claimId)
      }
    } else {
      const { data: fresh, error } = await admin.from('insurance_claims').insert({
        vendor_id: vendorId, insurer_customer_id: insurerCustomerId,
        claim_no: claimNo,
        vehicle_no: extras?.vehicleNo || null,
        workshop_job_ref: extras?.jobRef || null,
        created_by: extras?.createdBy || null,
      }).select('id').single()
      if (error || !fresh) {
        // Unique-index race: someone created it between our read and write
        const { data: raced } = await admin.from('insurance_claims')
          .select('id').eq('vendor_id', vendorId).eq('insurer_customer_id', insurerCustomerId)
          .ilike('claim_no', claimNo).maybeSingle()
        if (!raced) return { claimId: null, created: false, warning: 'Could not record the claim: ' + (error?.message || 'unknown') }
        claimId = raced.id
      } else {
        claimId = fresh.id
        created = true
      }
    }

    const { error: linkErr } = await admin.from('sales').update({ claim_id: claimId }).eq('id', saleId).eq('vendor_id', vendorId)
    if (linkErr) return { claimId, created, warning: 'Claim exists but the invoice could not be linked: ' + linkErr.message }
    return { claimId, created, warning: null }
  } catch (e: any) {
    return { claimId: null, created: false, warning: 'Claim linking failed: ' + (e?.message || 'unknown') }
  }
}
