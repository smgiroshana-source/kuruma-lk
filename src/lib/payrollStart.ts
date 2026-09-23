/**
 * The first salary cycle paid through the system: 25 Aug – 24 Sep 2026
 * (owner, 2026-08-24). Every earlier cycle was paid outside it, on paper, and
 * the advances taken in those cycles were deducted there.
 *
 * Payroll carries forward any advance no run in the system has settled, so it
 * can never be forgotten. Without this cutoff an advance from an old cycle
 * looks unsettled and comes off pay a second time — Buddhini's Rs.2,000 from
 * 24 Aug 2026 was about to (owner, 2026-09-23: "it was deducted").
 */
export const PAYROLL_FIRST_CYCLE_START = '2026-08-25'

/** True for an advance taken before the system paid salaries: already settled on paper. */
export const advanceSettledOutsideSystem = (date: string | null | undefined) =>
  !!date && date < PAYROLL_FIRST_CYCLE_START
