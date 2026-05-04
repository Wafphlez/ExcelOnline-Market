/** Файл из `public/` с учётом `vite.config` `base` (GitHub Project Pages и т.п.). */
export function publicAssetUrl(fileName: string): string {
  const base = import.meta.env.BASE_URL ?? '/'
  const name = fileName.startsWith('/') ? fileName.slice(1) : fileName
  return `${ base }${ name }`
}
