export const CATEGORIES = [
  'Engine Parts', 'Transmission & Drivetrain', 'Suspension & Steering', 'Brake System',
  'Electrical & Electronics', 'Body Parts', 'Lighting', 'Interior Parts',
  'A/C & Radiator', 'Wheels & Tires', 'Exhaust System', 'Filters & Fluids',
  'Accessories', 'Hybrid & EV Parts', 'Others', 'Windscreen',
  'Beading Belts and Rubber', 'Audio & Video', 'Safety'
]

export const MAKES = [
  'Toyota', 'Nissan', 'Honda', 'Suzuki', 'Mitsubishi',
  'Isuzu', 'Mazda', 'Hyundai', 'Kia', 'Daihatsu',
  'Perodua', 'Tata', 'Mahindra', 'BMW', 'Mercedes-Benz',
  'Audi', 'Other'
]

export const CONDITIONS = ['New-Genuine', 'New-Other', 'Reconditioned', 'Damaged']

export const ADMIN_EMAILS = (
  process.env.NEXT_PUBLIC_ADMIN_EMAILS || ''
).split(',').map(e => e.trim())

export const PLATFORM_WA = process.env.NEXT_PUBLIC_PLATFORM_WA || ''
export const PLATFORM_NAME = process.env.NEXT_PUBLIC_PLATFORM_NAME || 'kuruma.lk'