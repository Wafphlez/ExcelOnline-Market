import
  {
    DEFAULT_EVE_USER_AGENT,
    EVE_SSO_SCOPES_STRING,
    EVE_SSO_TOKEN_URL,
    EVE_SSO_VERIFY_URL,
    EVE_SSO_AUTH_URL,
    getSsoClientId,
    getSsoRedirectUri,
  } from './constants'
import { codeChallengeS256, generateCodeVerifier, randomState } from './pkce'
import type { EveTokenResponse, EveVerifyResponse } from './tokenTypes'
import
  {
    clearAllEveSession,
    getAccessToken,
    getRefreshToken,
    readPendingPkce,
    clearPendingPkce,
    savePendingPkce,
    setAccessToken,
    setRefreshToken,
    setStoredCharacterId,
  } from './authStore'

export function isEveSsoConfigured(): boolean
{
  return getSsoClientId().length > 0
}

export async function startEveSsoLogin(): Promise<void>
{
  const clientId = getSsoClientId()
  if (!clientId) throw new Error('Не задан VITE_EVE_SSO_CLIENT_ID (приложение CCP EVE Third Party).')

  const redirectUri = getSsoRedirectUri()
  const verifier = generateCodeVerifier()
  const state = randomState()
  const challenge = await codeChallengeS256(verifier)
  savePendingPkce(verifier, state)

  const u = new URL(EVE_SSO_AUTH_URL)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('client_id', clientId)
  u.searchParams.set('scope', EVE_SSO_SCOPES_STRING)
  u.searchParams.set('code_challenge', challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  u.searchParams.set('state', state)
  globalThis.window.location.assign(u.toString())
}

function parseCallbackSearch(search: string): { code: string; state: string } | null
{
  const q = new URLSearchParams(
    search.startsWith('?') ? search : `?${ search }`
  )
  const err = q.get('error')
  if (err)
  {
    const desc = q.get('error_description') ?? err
    throw new Error(String(desc))
  }
  const code = q.get('code')
  const state = q.get('state')
  if (code && state) return { code, state }
  return null
}

async function postToken(body: URLSearchParams): Promise<EveTokenResponse>
{
  const clientId = getSsoClientId()
  body.set('client_id', clientId)
  const res = await fetch(EVE_SSO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': DEFAULT_EVE_USER_AGENT,
    },
    body: body.toString(),
  })
  if (!res.ok)
  {
    const t = await res.text().catch(() => '')
    throw new Error(
      t ? `EVE SSO token: HTTP ${ res.status } — ${ t.slice(0, 200) }` : `EVE SSO token: HTTP ${ res.status }`
    )
  }
  return (await res.json()) as EveTokenResponse
}

export async function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string
): Promise<EveTokenResponse>
{
  const redirectUri = getSsoRedirectUri()
  const body = new URLSearchParams()
  body.set('grant_type', 'authorization_code')
  body.set('code', code)
  body.set('redirect_uri', redirectUri)
  body.set('code_verifier', codeVerifier)
  return postToken(body)
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<EveTokenResponse>
{
  const body = new URLSearchParams()
  body.set('grant_type', 'refresh_token')
  body.set('refresh_token', refreshToken)
  return postToken(body)
}

export async function verifyAccess(
  accessToken: string
): Promise<EveVerifyResponse>
{
  const res = await fetch(EVE_SSO_VERIFY_URL, {
    headers: {
      Authorization: `Bearer ${ accessToken }`,
      'User-Agent': DEFAULT_EVE_USER_AGENT,
    },
  })
  if (!res.ok)
  {
    const t = await res.text().catch(() => '')
    throw new Error(
      t ? `EVE /verify: HTTP ${ res.status } — ${ t.slice(0, 200) }` : `EVE /verify: HTTP ${ res.status }`
    )
  }
  return (await res.json()) as EveVerifyResponse
}

/**
 * Точка на главной: если в URL пришли code+state, обменять и очистить адрес.
 * @returns true если был обработан callback
 */
export async function tryFinishOAuthOnLoad(
  onMessage?: (msg: string) => void
): Promise<boolean>
{
  const raw = globalThis.window.location.search
  if (!raw?.includes('code=')) return false
  const parsed = parseCallbackSearch(raw)
  if (!parsed) return false
  const pending = readPendingPkce()
  if (!pending)
  {
    onMessage?.('SSO: нет сохранённого PKCE (state). Войдите снова.')
    globalThis.window.history.replaceState(
      {},
      '',
      globalThis.window.location.pathname + globalThis.window.location.hash
    )
    return true
  }
  if (pending.state !== parsed.state)
  {
    onMessage?.('SSO: state не совпал. Войдите снова.')
    clearPendingPkce()
    globalThis.window.history.replaceState(
      {},
      '',
      globalThis.window.location.pathname + globalThis.window.location.hash
    )
    return true
  }
  try
  {
    const token = await exchangeAuthorizationCode(parsed.code, pending.verifier)
    clearPendingPkce()
    if (token.refresh_token) setRefreshToken(token.refresh_token)
    setAccessToken(token.access_token, token.expires_in)
    const v = await verifyAccess(token.access_token)
    setStoredCharacterId(v.CharacterID)
    onMessage?.(`Вход выполнен: ${ v.CharacterName }`)
  } catch (e)
  {
    onMessage?.(e instanceof Error ? e.message : 'Ошибка SSO')
    clearPendingPkce()
  } finally
  {
    globalThis.window.history.replaceState(
      {},
      '',
      globalThis.window.location.pathname + globalThis.window.location.hash
    )
  }
  return true
}

export async function ensureValidAccessToken(): Promise<string | null>
{
  const existing = getAccessToken()
  if (existing) return existing
  const refresh = getRefreshToken()
  if (!refresh) return null
  try
  {
    const token = await refreshAccessToken(refresh)
    if (token.refresh_token) setRefreshToken(token.refresh_token)
    setAccessToken(token.access_token, token.expires_in)
    return token.access_token
  } catch
  {
    clearAllEveSession()
    return null
  }
}

export function logoutEveSession(): void
{
  clearAllEveSession()
}
