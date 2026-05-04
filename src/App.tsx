import { useEffect, useState } from 'react'
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
  const [bottomNebulaEnabled, setBottomNebulaEnabled] = useState(true)

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

  return (
    <div className={ `min-h-screen eve-ui-root text-white lg:h-screen lg:overflow-hidden lg:flex lg:flex-col ${
      bottomNebulaEnabled ? '' : 'nebula-bottom-off'
    }` }>
      <div className="space-backdrop" aria-hidden>
        <div className="space-backdrop-flicker-a" />
        <div className="space-backdrop-flicker-b" />
      </div>
      { !uiHidden && (
      <div className="relative z-[1] min-h-screen lg:flex lg:h-screen lg:flex-col">
        <div className="glass-panel shrink-0 border-x-0 border-t-0 rounded-none px-4 py-2">
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
            <div className="inline-flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setUiHidden(true)}
                className="rounded-md border border-eve-border/80 bg-eve-surface/45 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-eve-muted hover:border-eve-accent/45 hover:text-eve-bright focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 focus-visible:ring-offset-1 focus-visible:ring-offset-eve-surface"
                title="Скрыть панели и контент, оставить только фон"
              >
                Скрыть UI
              </button>
              <button
                type="button"
                onClick={ () => setBottomNebulaEnabled((current) => !current) }
                className={ `rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 focus-visible:ring-offset-1 focus-visible:ring-offset-eve-surface ${
                  bottomNebulaEnabled
                    ? 'border-eve-accent bg-eve-accent-muted text-eve-accent'
                    : 'border-eve-border/80 bg-eve-surface/45 text-eve-muted hover:border-eve-accent/45 hover:text-eve-bright'
                }` }
                title={ bottomNebulaEnabled ? 'Выключить нижнее облако' : 'Включить нижнее облако' }
              >
                Облако низ: { bottomNebulaEnabled ? 'ON' : 'OFF' }
              </button>
              <span className="eve-kicker">Theme</span>
              <div className="inline-flex flex-wrap items-center gap-1.5">
              {APP_THEMES.map((themeId) => (
                <button
                  key={themeId}
                  type="button"
                  onClick={() => setTheme(themeId)}
                  className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${
                    theme === themeId
                      ? 'border-eve-accent bg-eve-accent-muted text-eve-accent glow-kpi'
                      : 'border-eve-border/80 bg-eve-surface/45 text-eve-muted hover:border-eve-accent/45 hover:text-eve-bright'
                  }`}
                  title={`Применить тему ${getAppThemeLabel(themeId)}`}
                >
                  {getAppThemeLabel(themeId)}
                </button>
              ))}
              </div>
            </div>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
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
