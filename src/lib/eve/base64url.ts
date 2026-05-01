export function toBase64Url(bytes: Uint8Array): string
{
  let bin = ''
  for (const b of bytes)
  {
    bin += String.fromCodePoint(b)
  }
  let s = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_')
  while (s.endsWith('='))
  {
    s = s.slice(0, -1)
  }
  return s
}
