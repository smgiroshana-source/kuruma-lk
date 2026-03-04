// ============================================================
// CHANGES FOR: src/app/product/[id]/ProductDetail.tsx
// Feature: 6 (Replace ↗️ button with Share button)
// ============================================================

// FIND this block (in the desktop buttons area):
//
//   <a href={buildShareUrl()} target="_blank" className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm px-4 py-3 rounded-xl transition" title="Share via WhatsApp">↗️</a>
//
// REPLACE WITH:

                <button
                  onClick={() => {
                    if (navigator.share) {
                      navigator.share({
                        title: product.name,
                        text: `Check out this part on kuruma.lk: ${product.name}`,
                        url: window.location.href,
                      }).catch(() => {})
                    } else {
                      window.open(buildShareUrl(), '_blank')
                    }
                  }}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm px-4 py-3 rounded-xl transition"
                  title="Share this product">
                  📤 Share
                </button>

// ============================================================
// If there's a similar ↗️ button in the mobile sticky bar at the bottom,
// apply the same replacement there too.
// ============================================================
