export interface Vendor {
  id: string
  user_id: string
  name: string
  slug: string
  phone: string
  whatsapp: string
  location: string | null
  address: string | null
  description: string | null
  logo_url: string | null
  rating: number
  review_count: number
  status: 'pending' | 'approved' | 'suspended'
  created_at: string
  updated_at: string
}

export interface Product {
  id: string
  vendor_id: string
  sku: string | null
  name: string
  category: string
  make: string | null
  model: string | null
  year: string | null
  condition: string
  price: number | null
  show_price: boolean
  quantity: number
  sold_count: number
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  images?: ProductImage[]
  vendor?: Vendor
}

export interface ProductImage {
  id: string
  product_id: string
  url: string
  sort_order: number
}

export interface Sale {
  id: string
  vendor_id: string
  invoice_number: string
  customer_name: string
  customer_phone: string | null
  subtotal: number
  discount_percent: number
  discount_amount: number
  total: number
  created_at: string
  items?: SaleItem[]
}

export interface SaleItem {
  id: string
  sale_id: string
  product_id: string
  product_name: string
  quantity: number
  unit_price: number
  line_total: number
}