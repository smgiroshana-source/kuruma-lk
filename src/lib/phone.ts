// Sri Lankan phone numbers: exactly 10 digits starting with 0
// (07XXXXXXXX mobiles, 0XXXXXXXXX landlines). Spaces/dashes tolerated on input.
export function normalizePhone(p: string): string {
  return (p || '').replace(/[\s-]/g, '')
}

export function isValidSLPhone(p: string): boolean {
  return /^0\d{9}$/.test(normalizePhone(p))
}

export const PHONE_FORMAT_MSG = 'Phone must be 10 digits starting with 0 (e.g. 0771234567)'
