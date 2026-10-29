// ── A way out of every printout (owner, 2026-10-29) ──────────────────────────
// Bills, reports and slips open in a new window built with document.write.
// kuruma.lk is installed on phones as a home-screen app (manifest display:
// standalone), so that window has no browser toolbar: no back, no close, no
// address bar — staff were stuck on the PDF. Every print window gets a bar of
// its own: ✕ Close and Print / Save PDF. It is screen-only and never prints.
//
// Call it right after win.document.close(). Built with the child window's own
// DOM, so it works whatever HTML the report wrote.
export function addCloseBar(w: Window | null | undefined): void {
  if (!w || w.closed) return
  try {
    const d = w.document
    if (!d?.body || d.getElementById('kl-printbar')) return

    const style = d.createElement('style')
    style.textContent =
      '#kl-printbar{position:fixed;top:0;left:0;right:0;z-index:2147483647;display:flex;gap:8px;align-items:center;' +
      'padding:8px 10px;padding-top:max(8px,env(safe-area-inset-top));background:#0f172a;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.25)}' +
      '#kl-printbar button{min-height:44px;padding:0 16px;border:0;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer}' +
      '#kl-printbar .kl-close{background:#fff;color:#0f172a}' +
      '#kl-printbar .kl-print{margin-left:auto;background:#f97316;color:#fff}' +
      '@media screen{body{padding-top:calc(64px + env(safe-area-inset-top)) !important}}' +
      '@media print{#kl-printbar{display:none !important}}'
    d.head?.appendChild(style)

    const bar = d.createElement('div')
    bar.id = 'kl-printbar'
    const close = d.createElement('button')
    close.type = 'button'
    close.className = 'kl-close'
    close.textContent = '✕ Close'
    close.onclick = () => {
      w.close()
      // A window the browser won't let us close (opened in the same tab on
      // some phones): step back to where we came from instead
      const home = window.location.origin + '/vendor'
      setTimeout(() => { if (!w.closed) { if (w.history.length > 1) w.history.back(); else w.location.replace(home) } }, 300)
    }
    const print = d.createElement('button')
    print.type = 'button'
    print.className = 'kl-print'
    print.textContent = 'Print / Save PDF'
    print.onclick = () => w.print()
    bar.append(close, print)
    d.body.prepend(bar)
  } catch { /* a print window must never fail because of its toolbar */ }
}
