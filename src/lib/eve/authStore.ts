import
  {
    LS_EVE_CHARACTER_ID,
    LS_EVE_REFRESH,
    SS_EVE_ACCESS,
    SS_EVE_ACCESS_EXP,
  } from './constants'

const PKCE_KEY = 'excelMarket_eveSsoPkceVerifier'
const STATE_KEY = 'excelMarket_eveSsoOAuthState'

export function savePendingPkce(verifier: string, state: string): void
{
  try
  {
    sessionStorage.setItem(PKCE_KEY, verifier)
    sessionStorage.setItem(STATE_KEY, state)
  } catch
  {
    /* ignore */
  }
}

export function readPendingPkce(): { verifier: string; state: string } | null
{
  try
  {
    const verifier = sessionStorage.getItem(PKCE_KEY) ?? ''
    const state = sessionStorage.getItem(STATE_KEY) ?? ''
    if (!verifier || !state) return null
    return { verifier, state }
  } catch
  {
    return null
  }
}

export function clearPendingPkce(): void
{
  try
  {
    sessionStorage.removeItem(PKCE_KEY)
    sessionStorage.removeItem(STATE_KEY)
  } catch
  {
    /* ignore */
  }
}

export function setAccessToken(access: string, expiresInSec: number): void
{
  const exp = Date.now() + Math.max(0, expiresInSec - 30) * 1000
  try
  {
    sessionStorage.setItem(SS_EVE_ACCESS, access)
    sessionStorage.setItem(SS_EVE_ACCESS_EXP, String(exp))
  } catch
  {
    /* ignore */
  }
}

export function getAccessToken(): string | null
{
  try
  {
    const t = sessionStorage.getItem(SS_EVE_ACCESS)
    const e = sessionStorage.getItem(SS_EVE_ACCESS_EXP)
    if (!t || !e) return null
    if (Date.now() > Number(e)) return null
    return t
  } catch
  {
    return null
  }
}

export function clearAccessToken(): void
{
  try
  {
    sessionStorage.removeItem(SS_EVE_ACCESS)
    sessionStorage.removeItem(SS_EVE_ACCESS_EXP)
  } catch
  {
    /* ignore */
  }
}

export function setRefreshToken(refresh: string | null): void
{
  try
  {
    if (refresh) localStorage.setItem(LS_EVE_REFRESH, refresh)
    else localStorage.removeItem(LS_EVE_REFRESH)
  } catch
  {
    /* ignore */
  }
}

export function getRefreshToken(): string | null
{
  try
  {
    return localStorage.getItem(LS_EVE_REFRESH)
  } catch
  {
    return null
  }
}

export function setStoredCharacterId(id: number | null): void
{
  try
  {
    if (id != null) localStorage.setItem(LS_EVE_CHARACTER_ID, String(id))
    else localStorage.removeItem(LS_EVE_CHARACTER_ID)
  } catch
  {
    /* ignore */
  }
}

export function getStoredCharacterId(): number | null
{
  try
  {
    const v = localStorage.getItem(LS_EVE_CHARACTER_ID)
    if (v == null) return null
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
  } catch
  {
    return null
  }
}

export function clearAllEveSession(): void
{
  clearPendingPkce()
  clearAccessToken()
  setRefreshToken(null)
  setStoredCharacterId(null)
}
