import { toBase64Url } from './base64url'

const PKCE_VERIFIER_LEN = 64

function randomString(len: number): string
{
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  let s = ''
  for (let i = 0; i < len; i++)
  {
    s += alphabet[bytes[i]! % alphabet.length]!
  }
  return s
}

export function generateCodeVerifier(): string
{
  return randomString(PKCE_VERIFIER_LEN)
}

export async function sha256Bytes(input: string): Promise<ArrayBuffer>
{
  const data = new TextEncoder().encode(input)
  return crypto.subtle.digest('SHA-256', data)
}

export async function codeChallengeS256(verifier: string): Promise<string>
{
  const hash = await sha256Bytes(verifier)
  return toBase64Url(new Uint8Array(hash))
}

export function randomState(): string
{
  return randomString(32)
}
