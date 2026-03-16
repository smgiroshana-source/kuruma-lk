const fs = require('fs')
const FILE = 'src/app/api/vendor/sales/route.ts'
let code = fs.readFileSync(FILE, 'utf8')
let changes = 0

function replace(label, from, to) {
  if (!code.includes(from)) { console.error(`❌ NOT FOUND: ${label}`); return }
  code = code.replace(from, to)
  console.log(`✅ ${label}`)
  changes++
}

// Fix the main sales query to include payments
replace(
  'Add payments to main sales query',
  `.select('*, items:sale_items(id, product_name, product_sku, quantity, unit_price, unit_cost, total), customer:customers(id, name, phone)')`,
  `.select('*, items:sale_items(id, product_name, product_sku, quantity, unit_price, unit_cost, total), customer:customers(id, name, phone), payments:payments(id, amount, payment_method)')`
)

fs.writeFileSync(FILE, code, 'utf8')
console.log(`\n${changes}/1 changes applied`)
