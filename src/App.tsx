import { useEffect, useRef, useState } from 'react'
import { CharacterDashboard } from './components/character/CharacterDashboard'
import { tryFinishOAuthOnLoad } from './lib/eve/eveSso'
import {
  APP_THEMES,
  type AppThemeId,
  applyAppThemeToDocument,
  getAppThemeLabel,
  persistAppTheme,
  readStoredAppTheme,
} from './lib/ui/theme'
import TradingView from './views/TradingView'
import StarfieldWarp, {
  WARP_SPEED_K_DEFAULT,
  WARP_SPEED_K_MAX,
  WARP_SPEED_K_MIN,
  clampWarpSpeedK,
} from './components/StarfieldWarp'

type AppTab = 'trading' | 'character'

function TabButton(
  { active, children, onClick }: Readonly<{
    active: boolean
    children: string
    onClick: () => void
  }>
): JSX.Element
{
  return (
    <button
      type="button"
      onClick={ onClick }
      className={ `rounded-md border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 focus-visible:ring-offset-1 focus-visible:ring-offset-eve-surface ${
        active
          ? 'border-eve-accent bg-eve-accent-muted text-eve-accent glow-kpi'
          : 'border-eve-border/80 bg-eve-surface/50 text-eve-muted hover:border-eve-accent/40 hover:text-eve-bright'
      }` }
    >
      { children }
    </button>
  )
}

export default function App(): JSX.Element
{
  const [tab, setTab] = useState<AppTab>('trading')
  const [theme, setTheme] = useState<AppThemeId>(() => readStoredAppTheme())
  const [bootMessage, setBootMessage] = useState<string | null>(null)
  const [uiHidden, setUiHidden] = useState(false)
  const [bottomNebulaEnabled, setBottomNebulaEnabled] = useState(false)
  const [warpDriveEnabled, setWarpDriveEnabled] = useState(true)
  const [warpSpeedK, setWarpSpeedK] = useState<number>(WARP_SPEED_K_DEFAULT)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsDropdownRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    applyAppThemeToDocument(theme)
    persistAppTheme(theme)
  }, [theme])

  useEffect(() =>
  {
    void tryFinishOAuthOnLoad((msg) =>
    {
      if (msg)
      {
        setBootMessage(msg)
        if (msg.includes('Вход выполнен')) setTab('character')
      }
    })
  }, [])

  useEffect(() =>
  {
    if (!settingsOpen) return undefined
    const onPointerDown = (e: PointerEvent): void =>
    {
      if (settingsDropdownRef.current?.contains(e.target as Node)) return
      setSettingsOpen(false)
    }
    const onKey = (e: KeyboardEvent): void =>
    {
      if (e.key === 'Escape') setSettingsOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () =>
    {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [settingsOpen])

  return (
    <div className={ `min-h-screen eve-ui-root text-white lg:h-screen lg:overflow-hidden lg:flex lg:flex-col ${
      bottomNebulaEnabled ? '' : 'nebula-bottom-off'
    }` }>
      <div className="space-backdrop" aria-hidden>
        <div className="space-backdrop-flicker-a" />
        <div className="space-backdrop-flicker-b" />
        { warpDriveEnabled && (
          <StarfieldWarp speedK={ warpSpeedK } />
        ) }
      </div>
      { !uiHidden && (
      <div className="relative z-[1] min-h-screen lg:flex lg:h-screen lg:flex-col">
        <div className="glass-panel relative z-[60] shrink-0 overflow-visible border-x-0 border-t-0 rounded-none px-4 py-2">
          <div className="eve-chrome-top mb-2" />
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2">
              <span className="eve-kicker mr-1">Раздел</span>
              <TabButton
                active={ tab === 'trading' }
                onClick={ () => setTab('trading') }
              >
                Trading
              </TabButton>
              <TabButton
                active={ tab === 'character' }
                onClick={ () => setTab('character') }
              >
                Персонаж
              </TabButton>
            </div>
            <div ref={settingsDropdownRef} className="relative flex justify-end">
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={ settingsOpen }
                onClick={() => setSettingsOpen((open) => !open)}
                className="rounded-md border border-eve-border/80 bg-eve-surface/45 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-eve-muted hover:border-eve-accent/45 hover:text-eve-bright focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 focus-visible:ring-offset-1 focus-visible:ring-offset-eve-surface"
              >
                Настройки{ ' ' }{ settingsOpen ? '▴' : '▾' }
              </button>
              {settingsOpen && (
                <div
                  className={ `absolute right-0 top-[calc(100%+6px)] z-[300] w-[min(19rem,calc(100vw-2rem))] rounded-md border border-eve-border/60 bg-eve-surface/95 p-3 shadow-glass-panel backdrop-blur-[10px]` }
                  role="listbox"
                  aria-label="Настройки интерфейса"
                >
                  <div className="flex max-h-[min(70vh,28rem)] flex-col gap-3 overflow-y-auto pr-0.5">
                    <button
                      type="button"
                      onClick={() => setUiHidden(true)}
                      className="w-full rounded-md border border-eve-border/80 bg-eve-surface/55 px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-eve-muted hover:border-eve-accent/45 hover:text-eve-bright focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45"
                      title="Скрыть панели и контент, оставить только фон"
                    >
                      Скрыть UI
                    </button>
                    <hr className="border-eve-border/40" />
                    <button
                      type="button"
                      onClick={ () => setBottomNebulaEnabled((current) => !current) }
                      className={ `w-full rounded-md border px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 focus-visible:ring-offset-1 focus-visible:ring-offset-eve-surface ${
                        bottomNebulaEnabled
                          ? 'border-eve-accent bg-eve-accent-muted text-eve-accent'
                          : 'border-eve-border/80 bg-eve-surface/45 text-eve-muted hover:border-eve-accent/45 hover:text-eve-bright'
                      }` }
                    >
                      Облако низ: { bottomNebulaEnabled ? 'ON' : 'OFF' }
                    </button>
                    <div className="rounded-md border border-eve-border/45 bg-eve-bg/35 p-2.5">
                      <button
                        type="button"
                        onClick={ () => setWarpDriveEnabled((current) => !current) }
                        className={ `mb-2 w-full rounded border px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-[0.08em] focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 focus-visible:ring-offset-1 focus-visible:ring-offset-eve-surface ${
                          warpDriveEnabled
                            ? 'border-eve-accent bg-eve-accent-muted text-eve-accent'
                            : 'border-eve-border/80 bg-eve-surface/45 text-eve-muted hover:border-eve-accent/45 hover:text-eve-bright'
                        }` }
                      >
                        Warp: { warpDriveEnabled ? 'ON' : 'OFF' }
                      </button>
                      <label className="flex flex-col gap-1.5 text-[11px] text-eve-muted">
                        <span className="eve-kicker">Warp speed</span>
                        <input
                          type="range"
                          min={ WARP_SPEED_K_MIN }
                          max={ WARP_SPEED_K_MAX }
                          step={ 0.0001 }
                          value={ warpSpeedK }
                          onChange={ (e) => setWarpSpeedK(parseFloat(e.target.value)) }
                          disabled={ !warpDriveEnabled }
                          title="speed = коэффициент × Δt (мс)"
                          className="eve-warp-slider h-1 w-full cursor-pointer accent-eve-accent disabled:opacity-40"
                        />
                        <input
                          type="number"
                          min={ WARP_SPEED_K_MIN }
                          max={ WARP_SPEED_K_MAX }
                          step={ 0.0001 }
                          value={ warpSpeedK }
                          onChange={ (e) =>
                          {
                            const parsed = Number.parseFloat(e.target.value)
                            setWarpSpeedK(clampWarpSpeedK(Number.isFinite(parsed) ? parsed : WARP_SPEED_K_DEFAULT))
                          } }
                          disabled={ !warpDriveEnabled }
                          className="w-full rounded border border-eve-border/65 bg-eve-bg/85 px-1.5 py-1 font-mono text-[10px] tabular-nums text-eve-bright outline-none ring-eve-accent/35 focus-visible:ring-[1px] disabled:opacity-40"
                        />
                      </label>
                    </div>
                    <div>
                      <span className="eve-kicker mb-1.5 block">Theme</span>
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                        {APP_THEMES.map((themeId) => (
                          <button
                            key={themeId}
                            type="button"
                            onClick={() =>
                            {
                              setTheme(themeId)
                              setSettingsOpen(false)
                            } }
                            className={ `rounded-md border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${
                              theme === themeId
                                ? 'border-eve-accent bg-eve-accent-muted text-eve-accent glow-kpi'
                                : 'border-eve-border/80 bg-eve-surface/45 text-eve-muted hover:border-eve-accent/45 hover:text-eve-bright'
                            }` }
                          >
                            { getAppThemeLabel(themeId) }
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="relative z-0 flex min-h-0 flex-1 flex-col">
          { tab === 'trading' ? <TradingView /> : (
            <CharacterDashboard
              bootMessage={ bootMessage }
              onClearBootMessage={ () => setBootMessage(null) }
            />
          ) }
        </div>
      </div>
      ) }
      { uiHidden && (
        <button
          type="button"
          onClick={() => setUiHidden(false)}
          className="glass-panel fixed bottom-5 right-5 z-[100] rounded-md border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-eve-bright shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 focus-visible:ring-offset-2 focus-visible:ring-offset-eve-bg"
          title="Вернуть интерфейс приложения"
        >
          Показать UI
        </button>
      ) }
    </div>
  )
}
