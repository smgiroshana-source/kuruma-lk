export const CATEGORIES = [
  'Engine Parts', 'Transmission', 'Brakes', 'Suspension',
  'Electrical', 'Body Parts', 'Interior', 'Exhaust',
  'Cooling System', 'Fuel System', 'Steering',
  'Wheels & Tires', 'Lighting', 'AC & Heating', 'Other'
]

export const MAKES = [
  'Toyota', 'Nissan', 'Honda', 'Suzuki', 'Mitsubishi',
  'Isuzu', 'Mazda', 'Hyundai', 'Kia', 'Daihatsu',
  'Perodua', 'Tata', 'Mahindra', 'BMW', 'Mercedes-Benz',
  'Audi', 'Other'
]

export const CONDITIONS = ['Excellent', 'Good', 'Fair', 'Salvage']

export const ADMIN_EMAILS = (
  process.env.NEXT_PUBLIC_ADMIN_EMAILS || ''
).split(',').map(e => e.trim())

export const PLATFORM_WA = process.env.NEXT_PUBLIC_PLATFORM_WA || ''
export const PLATFORM_NAME = process.env.NEXT_PUBLIC_PLATFORM_NAME || 'kuruma.lk'