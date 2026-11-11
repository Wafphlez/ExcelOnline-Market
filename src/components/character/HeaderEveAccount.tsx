import { useEffect, useRef, useState } from 'react'
import { User } from 'lucide-react'
import { fetchPublicCharacter } from '../../lib/eve/characterEsi'
import
  {
    EVE_SESSION_CHANGED_EVENT,
    EVE_SSO_OFFICIAL_LOGIN_BUTTONS,
    characterPortraitUrl,
  } from '../../lib/eve/constants'
import
  {
    getAccessToken,
    getRefreshToken,
    getStoredCharacterId,
    getStoredCharacterName,
    setStoredCharacterName,
  } from '../../lib/eve/authStore'
import
  {
    isEveSsoConfigured,
    logoutEveSession,
    startEveSsoLogin,
  } from '../../lib/eve/eveSso'

type EveAccountSession = {
  loggedIn: boolean
  characterId: number | null
  characterName: string | null
}

function readEveAccountSession(): EveAccountSession
{
  const loggedIn = getRefreshToken() != null || getAccessToken() != null
  if (!loggedIn)
  {
    return { loggedIn: false, characterId: null, characterName: null }
  }
  return {
    loggedIn: true,
    characterId: getStoredCharacterId(),
    characterName: getStoredCharacterName(),
  }
}

/**
 * Кнопка EVE SSO слева от настроек: та же высота, что у «Настроек».
 * После входа — аватар и имя, по нажатию меню с выходом.
 */
export function HeaderEveAccount(): JSX.Element
{
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [session, setSession] = useState(readEveAccountSession)
  const [menuOpen, setMenuOpen] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const configured = isEveSsoConfigured()

  useEffect(() =>
  {
    const sync = (): void =>
    {
      setSession(readEveAccountSession())
      setMenuOpen(false)
    }
    window.addEventListener(EVE_SESSION_CHANGED_EVENT, sync)
    return () => window.removeEventListener(EVE_SESSION_CHANGED_EVENT, sync)
  }, [])

  useEffect(() =>
  {
    if (!session.loggedIn || session.characterId == null || session.characterName)
    {
      return undefined
    }
    const characterId = session.characterId
    let cancelled = false
    void fetchPublicCharacter(characterId)
      .then((info) =>
      {
        if (cancelled) return
        setStoredCharacterName(info.name)
        setSession((prev) =>
          prev.characterId === characterId
            ? { ...prev, characterName: info.name }
            : prev
        )
      })
      .catch(() =>
      {
        /* имя необязательно для меню выхода */
      })
    return () =>
    {
      cancelled = true
    }
  }, [session.loggedIn, session.characterId, session.characterName])

  useEffect(() =>
  {
    if (!menuOpen) return undefined
    const onPointerDown = (e: PointerEvent): void =>
    {
      if (rootRef.current?.contains(e.target as Node)) return
      setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent): void =>
    {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () =>
    {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const onLogin = (): void =>
  {
    setLoginError(null)
    void startEveSsoLogin().catch((e: unknown) =>
    {
      setLoginError(e instanceof Error ? e.message : 'Ошибка SSO')
    })
  }

  const onLogout = (): void =>
  {
    setMenuOpen(false)
    logoutEveSession()
  }

  return (
    <div ref={ rootRef } className="relative flex h-11 shrink-0 items-center">
      { session.loggedIn ? (
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={ menuOpen }
          aria-label={ session.characterName
            ? `${ session.characterName }, меню персонажа`
            : 'Меню персонажа' }
          onClick={ () => setMenuOpen((open) => !open) }
          className="flex h-11 max-w-[16rem] items-center overflow-hidden rounded-md border border-eve-border/80 bg-eve-surface/45 p-0 text-left text-eve-bright hover:border-eve-accent/45 focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 focus-visible:ring-offset-1 focus-visible:ring-offset-eve-surface"
        >
          { session.characterId != null ? (
            <img
              src={ characterPortraitUrl(session.characterId, 128) }
              width={ 42 }
              height={ 42 }
              alt=""
              className="ml-px h-[calc(100%-2px)] w-auto shrink-0 aspect-square rounded-l-[calc(0.375rem-1.8px)] object-cover"
              draggable={ false }
            />
          ) : (
            <span className="ml-px inline-flex aspect-square h-[calc(100%-2px)] shrink-0 items-center justify-center rounded-l-[calc(0.375rem-1.8px)] text-eve-muted">
              <User className="h-4 w-4" aria-hidden />
            </span>
          ) }
          <span className="flex min-w-0 items-center px-2.5">
            <span className="truncate text-base font-bold text-eve-bright/95 [text-shadow:0_0_8px_rgba(236,238,242,0.04)]">
              { session.characterName ?? 'Персонаж' }
            </span>
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={ onLogin }
          disabled={ !configured }
          title={ configured
            ? 'Войти через EVE SSO'
            : 'Укажите VITE_EVE_SSO_CLIENT_ID' }
          className="flex h-11 items-center rounded-md p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/70 focus-visible:ring-offset-1 focus-visible:ring-offset-eve-surface enabled:hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <img
            src={ EVE_SSO_OFFICIAL_LOGIN_BUTTONS.largeWhite }
            width={ 270 }
            height={ 45 }
            className="block h-11 w-auto"
            alt="LOG IN with EVE Online"
            draggable={ false }
          />
        </button>
      ) }
      { menuOpen && session.loggedIn && (
        <div
          role="menu"
          aria-label="Меню персонажа"
          className="absolute right-0 top-[calc(100%+6px)] z-[300] min-w-[9rem] rounded-md border border-eve-border/60 bg-eve-surface/95 p-1.5 shadow-glass-panel backdrop-blur-[10px]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={ onLogout }
            className="w-full rounded-md border border-eve-danger/70 bg-eve-danger/15 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-eve-danger hover:border-eve-danger hover:bg-eve-danger/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-danger/45"
          >
            Выйти
          </button>
        </div>
      ) }
      { loginError && (
        <p
          role="alert"
          className="absolute right-0 top-[calc(100%+6px)] z-[300] w-64 rounded-md border border-eve-danger/45 bg-eve-surface/95 px-2.5 py-2 text-[11px] text-eve-danger shadow-glass-panel"
        >
          { loginError }
        </p>
      ) }
    </div>
  )
}
