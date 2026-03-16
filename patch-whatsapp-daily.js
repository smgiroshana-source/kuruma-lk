const fs = require('fs')
const FILE = 'src/app/vendor/page.tsx'
let code = fs.readFileSync(FILE, 'utf8')

const OLD = `    const dateStr = new Date(reportDate).toLocaleDateString('en-LK', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
    let msg = \`*📊 Daily Sales Report*%0A\${vendorInfo?.name || 'kuruma.lk'}%0A\${dateStr}%0A%0A\`
    msg += \`💰 *Total Sales: Rs.\${total.toLocaleString()}*%0A\`
    msg += \`✅ Collected: Rs.\${paid.toLocaleString()}%0A\`
    if (credit > 0) msg += \`⚠️ On Credit: Rs.\${credit.toLocaleString()}%0A\`
    msg += \`📋 Invoices: \${filtered.length}%0A%0A\`

    if (Object.keys(methods).length > 0) {
      msg += \`*Payment Breakdown:*%0A\`
      if (methods.cash) msg += \`💵 Cash: Rs.\${methods.cash.toLocaleString()}%0A\`
      if (methods.cheque) msg += \`📝 Cheque: Rs.\${methods.cheque.toLocaleString()}%0A\`
      if (methods.bank) msg += \`🏦 Bank: Rs.\${methods.bank.toLocaleString()}%0A\`
      if (methods.card) msg += \`💳 Card: Rs.\${methods.card.toLocaleString()}%0A\`
      if (methods.advance) msg += \`💰 Advance: Rs.\${methods.advance.toLocaleString()}%0A\`
    }

    msg += \`%0A— \${vendorInfo?.name || 'kuruma.lk'}\`
    window.open(\`https://wa.me/?text=\${msg}\`, '_blank')`

const NEW = `    const dateStr = new Date(reportDate).toLocaleDateString('en-LK', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })

    let lines: string[] = []
    lines.push(\`📊 *Daily Sales Report*\`)
    lines.push(\`\${vendorInfo?.name || 'kuruma.lk'}\`)
    lines.push(\`\${dateStr}\`)
    lines.push(\`━━━━━━━━━━━━━━━━━━\`)
    lines.push(\`💰 *Total: Rs.\${total.toLocaleString()}*\`)
    lines.push(\`✅ Collected: Rs.\${paid.toLocaleString()}\`)
    if (credit > 0) lines.push(\`⚠️ Outstanding: Rs.\${credit.toLocaleString()}\`)
    lines.push(\`📋 Invoices: \${filtered.length}\`)

    if (Object.keys(methods).length > 0) {
      lines.push(\`\`)
      lines.push(\`*Payment Breakdown:*\`)
      if (methods.cash) lines.push(\`  💵 Cash: Rs.\${methods.cash.toLocaleString()}\`)
      if (methods.cheque) lines.push(\`  📝 Cheque: Rs.\${methods.cheque.toLocaleString()}\`)
      if (methods.bank) lines.push(\`  🏦 Bank: Rs.\${methods.bank.toLocaleString()}\`)
      if (methods.card) lines.push(\`  💳 Card: Rs.\${methods.card.toLocaleString()}\`)
      if (methods.advance) lines.push(\`  🔄 Advance: Rs.\${methods.advance.toLocaleString()}\`)
    }

    if (filtered.length > 0) {
      lines.push(\`\`)
      lines.push(\`*Invoices:*\`)
      filtered.forEach((sale: any) => {
        const custName = sale.customer?.name || sale.customer_name || 'Walk-in'
        const status = sale.balance_due > 0 ? \`⚠️ Due: Rs.\${parseFloat(sale.balance_due).toLocaleString()}\` : \`✅ Paid\`
        lines.push(\`  \${sale.invoice_no} — \${custName} — Rs.\${parseFloat(sale.total).toLocaleString()} [\${status}]\`)
      })
    }

    lines.push(\`\`)
    lines.push(\`— \${vendorInfo?.name || 'kuruma.lk'}\`)

    const msg = encodeURIComponent(lines.join('\\n'))
    window.open(\`https://wa.me/?text=\${msg}\`, '_blank')`

if (code.includes(OLD)) {
  code = code.replace(OLD, NEW)
  fs.writeFileSync(FILE, code, 'utf8')
  console.log('✅ whatsAppDailyReport fixed')
} else {
  console.error('❌ Not found')
  const idx = code.indexOf('let msg = `*📊 Daily Sales Report*')
  if (idx !== -1) console.log('Nearby:', JSON.stringify(code.slice(idx - 20, idx + 100)))
}
