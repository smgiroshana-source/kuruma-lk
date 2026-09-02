// Client-side JPEG compression for product photo uploads (binary-searches
// quality to fit under maxSizeKB, capping width at 1200px). Extracted from
// vendor/page.tsx so stock-count damage capture can reuse the same pipeline.
export async function compressImage(file: File, maxSizeKB = 125): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image(); const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url); const canvas = document.createElement('canvas')
      let { width, height } = img; if (width > 1200) { height = Math.round(height * (1200 / width)); width = 1200 }
      canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0, width, height)
      let lo = 0.1, hi = 0.92, bestBlob: Blob | null = null
      function tryQ() { const mid = (lo + hi) / 2; canvas.toBlob((blob) => { if (!blob) { resolve(file); return }; if (blob.size / 1024 <= maxSizeKB) { bestBlob = blob; lo = mid } else { hi = mid; if (!bestBlob) bestBlob = blob }; if (hi - lo > 0.02) tryQ(); else resolve(new File([bestBlob || blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })) }, 'image/jpeg', mid) }
      tryQ()
    }
    // A format the browser cannot decode — an iPhone HEIC from the gallery is
    // the common one — never fires onload, and this promise used to hang
    // forever: the sheet sat on "Uploading…" and nothing arrived. The server
    // converts with sharp and falls back to the original, so send it as is.
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}
