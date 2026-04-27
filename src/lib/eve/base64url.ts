export function toBase64Url(bytes: Uint8Array): string
{
  let bin = ''
  for (let i = 0; i < bytes.length; i++)
  {
    bin += String.fromCharCode(bytes[i]!)
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
