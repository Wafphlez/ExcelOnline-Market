/** Сохраняет xlsx в папку загрузок браузера (или диалог «Сохранить как»). */
export function downloadXlsxBytes(data: Uint8Array, fileName: string): void {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  const blob = new Blob([copy], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  a.click()
  URL.revokeObjectURL(url)
}
