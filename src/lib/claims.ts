// Linking an insurance sale to its claim — shared by the POS sale flow and the
// workshop invoice API so both invoices of one repair land on the same claim
// however they were raised.
//
// The cashier rarely knows the insurer's claim number at billing time (owner,
// 2026-08-24) — but always knows the VEHICLE, which the POS already requires
// on insurance bills. So linking keys on what is actually known:
//
//   claim number typed  → find that claim (case-insensitive) or create it
//   no number, vehicle  → find the insurer's un-closed claim for this vehicle,
//                         or start one with no number yet
//   neither             → no link
//
// The claim number is attached LATER, on the Claims screen, when the insurer's
// paperwork (which always carries it) arrives — that is the moment it exists
// for settlement matching.
//
// Best-effort by design: a claim-linking hiccup must never kill a sale whose
// gazette serial is already minted. Callers surface `warning` to the operator
// instead of failing.

export interface ClaimLinkResult {
  claimId: string | null
  created: boolean
  warning: string | null
}

export async function linkSaleToClaim(
  admin: any,
  vendorId: string,
  saleId: string,
  insurerCustomerId: string,
  claimNoRaw: string | null | undefined,
  extras?: { vehicleNo?: string | null; jobRef?: string | null; createdBy?: string | null },
): Promise<ClaimLinkResult> {
  const claimNo = String(claimNoRaw || '').trim()
  const vehicleNo = String(extras?.vehicleNo || '').trim()
  if (!claimNo && !vehicleNo) return { claimId: null, created: false, warning: null }

  try {
    // Only insurers carry claims. Silent skip — this runs on every insurance-
    // flagged sale, and a mis-flagged customer is not the cashier's problem.
    const { data: insurer } = await admin.from('customers')
      .select('id, is_insurance').eq('id', insurerCustomerId).eq('vendor_id', vendorId).single()
    if (!insurer?.is_insurance) {
      return { claimId: null, created: false, warning: claimNo ? 'Claim number ignored — the customer is not marked as an insurance company' : null }
    }

    let existing: any = null
    if (claimNo) {
      const { data } = await admin.from('insurance_claims')
        .select('id, vehicle_no, workshop_job_ref')
        .eq('vendor_id', vendorId).eq('insurer_customer_id', insurerCustomerId)
        .ilike('claim_no', claimNo)
        .maybeSingle()
      existing = data
    }
    if (!existing && vehicleNo) {
      // One un-closed claim on this vehicle with this insurer → that is the
      // accident. More than one → the shop is running MULTIPLE claims on the
      // vehicle at once (it happens — separate invoices per claim), and only
      // the operator knows which is which: never guess, ask instead.
      const { data: candidates } = await admin.from('insurance_claims')
        .select('id, claim_no, vehicle_no, workshop_job_ref')
        .eq('vendor_id', vendorId).eq('insurer_customer_id', insurerCustomerId)
        .ilike('vehicle_no', vehicleNo)
        .neq('status', 'closed')
        .order('created_at', { ascending: false })
        .limit(2)
      if ((candidates || []).length > 1) {
        return {
          claimId: null, created: false,
          warning: `${vehicleNo} has ${candidates!.length}+ open claims with this insurer — invoice NOT linked. Type the claim number, or link it on the Claims screen.`,
        }
      }
      existing = candidates?.[0] || null
    }

    let claimId: string
    let created = false
    if (existing) {
      claimId = existing.id
      const patch: any = {}
      if (!existing.vehicle_no && vehicleNo) patch.vehicle_no = vehicleNo
      if (!existing.workshop_job_ref && extras?.jobRef) patch.workshop_job_ref = extras.jobRef
      // A typed number lands on a number-less claim found by vehicle
      if (claimNo && !existing.claim_no) patch.claim_no = claimNo
      if (Object.keys(patch).length) {
        patch.updated_at = new Date().toISOString()
        await admin.from('insurance_claims').update(patch).eq('id', claimId)
      }
    } else {
      const { data: fresh, error } = await admin.from('insurance_claims').insert({
        vendor_id: vendorId, insurer_customer_id: insurerCustomerId,
        claim_no: claimNo || null,
        vehicle_no: vehicleNo || null,
        workshop_job_ref: extras?.jobRef || null,
        created_by: extras?.createdBy || null,
      }).select('id').single()
      if (error || !fresh) {
        // Unique-index race: someone created it between our read and write
        const { data: raced } = claimNo
          ? await admin.from('insurance_claims')
              .select('id').eq('vendor_id', vendorId).eq('insurer_customer_id', insurerCustomerId)
              .ilike('claim_no', claimNo).maybeSingle()
          : { data: null }
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
