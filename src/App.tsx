import { useEffect, useRef, useState } from 'react'
import { Settings } from 'lucide-react'
import { useInputWheelNudge } from './hooks/useInputWheelNudge'
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
import { readMarketLogsPath, persistMarketLogsPath } from './components/ExportBar'
import { isDevExportServer } from './lib/devExportApi'
import TradingView from './views/TradingView'
import StarfieldWarp from './components/StarfieldWarp'

type AppTab = 'trading' | 'character'
type SettingsTab = 'main' | 'interface'

const LS_BROKER_PCT = 'excelMarket_brokerFeePct'
const LS_SALES_TAX_PCT = 'excelMarket_salesTaxPct'
const DEFAULT_BROKER_FEE_PCT = 1.4
const DEFAULT_SALES_TAX_PCT = 4.2

function readStoredFeePct(key: string, fallback: number): number
{
  try
  {
    const v = localStorage.getItem(key)
    if (v === null) return fallback
    const n = Number(String(v).replace(',', '.'))
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback
  } catch
  {
    return fallback
  }
}

function parseFeePctInput(raw: string): number | null
{
  const n = Number(raw.replace(',', '.'))
  if (!Number.isFinite(n) || n < 0 || n > 100) return null
  return n
}

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
  const [fallingStarsEnabled, setFallingStarsEnabled] = useState(true)
  const [staticStarsEnabled, setStaticStarsEnabled] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('main')
  const [marketLogsPath, setMarketLogsPath] = useState(readMarketLogsPath)
  const [brokerFeePct, setBrokerFeePct] = useState(() =>
    readStoredFeePct(LS_BROKER_PCT, DEFAULT_BROKER_FEE_PCT)
  )
  const [salesTaxPct, setSalesTaxPct] = useState(() =>
    readStoredFeePct(LS_SALES_TAX_PCT, DEFAULT_SALES_TAX_PCT)
  )
  const [brokerInputEl, setBrokerInputEl] = useState<HTMLInputElement | null>(null)
  const [taxInputEl, setTaxInputEl] = useState<HTMLInputElement | null>(null)
  const settingsDropdownRef = useRef<HTMLDivElement | null>(null)

  useInputWheelNudge(brokerInputEl, {
    step: 0.01,
    bounds: { min: 0, max: 100 },
    getValue: () => brokerFeePct,
    onNudge: (next) => setBrokerFeePct(Math.round(next * 100) / 100),
  })
  useInputWheelNudge(taxInputEl, {
    step: 0.01,
    bounds: { min: 0, max: 100 },
    getValue: () => salesTaxPct,
    onNudge: (next) => setSalesTaxPct(Math.round(next * 100) / 100),
  })

  useEffect(() => {
    applyAppThemeToDocument(theme)
    persistAppTheme(theme)
  }, [theme])

  useEffect(() =>
  {
    try
    {
      localStorage.setItem(LS_BROKER_PCT, String(brokerFeePct))
    } catch
    {
      /* ignore */
    }
  }, [brokerFeePct])

  useEffect(() =>
  {
    try
    {
      localStorage.setItem(LS_SALES_TAX_PCT, String(salesTaxPct))
    } catch
    {
      /* ignore */
    }
  }, [salesTaxPct])

  useEffect(() =>
  {
    persistMarketLogsPath(marketLogsPath)
  }, [marketLogsPath])

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
    } ${ fallingStarsEnabled ? '' : 'falling-stars-off' } ${
      staticStarsEnabled ? '' : 'static-stars-off'
    }` }>
      <div className="space-backdrop" aria-hidden>
        <div className="space-backdrop-flicker-a" />
        <div className="space-backdrop-flicker-b" />
        { warpDriveEnabled && (
          <StarfieldWarp />
        ) }
      </div>
      { !uiHidden && (
      <div className="relative z-[1] min-h-screen lg:flex lg:h-screen lg:flex-col">
        <header className="relative z-[60] shrink-0 overflow-visible px-3 pt-3 pb-1 sm:px-4">
          <div className="flex w-full flex-col items-stretch gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center lg:gap-x-6">
            <div className="flex items-center justify-between gap-2 lg:contents">
            <nav
              aria-label="Навигация"
              className="inline-flex min-w-0 items-center justify-start lg:col-start-1 lg:row-start-1"
            >
              <div className="inline-flex items-center gap-1.5 rounded-md border border-eve-border/55 bg-eve-surface/30 py-1 pl-2.5 pr-1">
                <span className="eve-kicker shrink-0 pr-0.5">Навигация</span>
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
            </nav>
            <div className="flex min-w-0 justify-end lg:col-start-3 lg:row-start-1 lg:justify-self-end">
            <div ref={settingsDropdownRef} className="relative">
              <button
                type="button"
                aria-label="Настройки"
                title="Настройки"
                aria-haspopup="listbox"
                aria-expanded={ settingsOpen }
                onClick={() => setSettingsOpen((open) => !open)}
                className="inline-flex h-11 items-center gap-1.5 rounded-md border border-eve-border/80 bg-eve-surface/45 px-3 text-eve-muted hover:border-eve-accent/45 hover:text-eve-bright focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 focus-visible:ring-offset-1 focus-visible:ring-offset-eve-surface"
              >
                <Settings className="h-5 w-5" aria-hidden />
                <span className="text-sm leading-none" aria-hidden>
                  { settingsOpen ? '▴' : '▾' }
                </span>
              </button>
              {settingsOpen && (
                <div
                  className="absolute right-0 top-[calc(100%+6px)] z-[300] w-[min(28rem,calc(100vw-2rem))] rounded-md border border-eve-border/60 bg-eve-surface/95 p-3 shadow-glass-panel backdrop-blur-[10px]"
                  aria-label="Настройки"
                >
                  <div className="mb-3 grid grid-cols-2 gap-1" role="tablist" aria-label="Разделы настроек">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={ settingsTab === 'main' }
                      onClick={ () => setSettingsTab('main') }
                      className={ `rounded-md border px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 ${
                        settingsTab === 'main'
                          ? 'border-eve-accent bg-eve-accent-muted text-eve-accent'
                          : 'border-eve-border/80 bg-eve-surface/45 text-eve-muted hover:border-eve-accent/45 hover:text-eve-bright'
                      }` }
                    >
                      Основные
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={ settingsTab === 'interface' }
                      onClick={ () => setSettingsTab('interface') }
                      className={ `rounded-md border px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 ${
                        settingsTab === 'interface'
                          ? 'border-eve-accent bg-eve-accent-muted text-eve-accent'
                          : 'border-eve-border/80 bg-eve-surface/45 text-eve-muted hover:border-eve-accent/45 hover:text-eve-bright'
                      }` }
                    >
                      Интерфейс
                    </button>
                  </div>
                  <div className="flex max-h-[min(70vh,28rem)] flex-col gap-3 overflow-y-auto pr-0.5">
                    {settingsTab === 'interface' && (
                    <>
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
                    <button
                      type="button"
                      onClick={ () => setWarpDriveEnabled((current) => !current) }
                      className={ `w-full rounded-md border px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 focus-visible:ring-offset-1 focus-visible:ring-offset-eve-surface ${
                        warpDriveEnabled
                          ? 'border-eve-accent bg-eve-accent-muted text-eve-accent'
                          : 'border-eve-border/80 bg-eve-surface/45 text-eve-muted hover:border-eve-accent/45 hover:text-eve-bright'
                      }` }
                    >
                      Warp: { warpDriveEnabled ? 'ON' : 'OFF' }
                    </button>
                    <button
                      type="button"
                      onClick={ () => setFallingStarsEnabled((current) => !current) }
                      className={ `w-full rounded-md border px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 focus-visible:ring-offset-1 focus-visible:ring-offset-eve-surface ${
                        fallingStarsEnabled
                          ? 'border-eve-accent bg-eve-accent-muted text-eve-accent'
                          : 'border-eve-border/80 bg-eve-surface/45 text-eve-muted hover:border-eve-accent/45 hover:text-eve-bright'
                      }` }
                    >
                      Падающие звезды: { fallingStarsEnabled ? 'ON' : 'OFF' }
                    </button>
                    <button
                      type="button"
                      onClick={ () => setStaticStarsEnabled((current) => !current) }
                      className={ `w-full rounded-md border px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 focus-visible:ring-offset-1 focus-visible:ring-offset-eve-surface ${
                        staticStarsEnabled
                          ? 'border-eve-accent bg-eve-accent-muted text-eve-accent'
                          : 'border-eve-border/80 bg-eve-surface/45 text-eve-muted hover:border-eve-accent/45 hover:text-eve-bright'
                      }` }
                    >
                      Статичные звезды: { staticStarsEnabled ? 'ON' : 'OFF' }
                    </button>
                    </>
                    )}
                    {settingsTab === 'main' && (
                    <>
                    <div className="rounded-md border border-eve-border/45 bg-eve-bg/35 p-2.5">
                      <span className="eve-kicker mb-2 block">Комиссии</span>
                      <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-eve-muted">
                        <span>Broker fee</span>
                        <span className="inline-flex items-center gap-1">
                          <input
                            ref={ setBrokerInputEl }
                            type="number"
                            min={ 0 }
                            max={ 100 }
                            step={ 0.01 }
                            value={ brokerFeePct }
                            aria-label="Broker fee, процент"
                            onChange={ (e) =>
                            {
                              const n = parseFeePctInput(e.target.value)
                              if (n === null) return
                              setBrokerFeePct(n)
                            } }
                            className="w-16 rounded border border-eve-border/65 bg-eve-bg/85 px-1.5 py-1 font-mono text-[10px] tabular-nums text-eve-bright outline-none ring-eve-accent/35 [appearance:textfield] focus-visible:ring-[1px] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                          <span className="tabular-nums">%</span>
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[11px] text-eve-muted">
                        <span>Sales tax</span>
                        <span className="inline-flex items-center gap-1">
                          <input
                            ref={ setTaxInputEl }
                            type="number"
                            min={ 0 }
                            max={ 100 }
                            step={ 0.01 }
                            value={ salesTaxPct }
                            aria-label="Sales tax, процент"
                            onChange={ (e) =>
                            {
                              const n = parseFeePctInput(e.target.value)
                              if (n === null) return
                              setSalesTaxPct(n)
                            } }
                            className="w-16 rounded border border-eve-border/65 bg-eve-bg/85 px-1.5 py-1 font-mono text-[10px] tabular-nums text-eve-bright outline-none ring-eve-accent/35 [appearance:textfield] focus-visible:ring-[1px] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                          <span className="tabular-nums">%</span>
                        </span>
                      </div>
                    </div>
                    {isDevExportServer && (
                      <div className="flex flex-col gap-1.5 text-[11px] text-eve-muted">
                        <span className="eve-kicker">Путь к папке</span>
                        <span>Market logs</span>
                        <input
                          type="text"
                          value={ marketLogsPath }
                          aria-label="Путь к папке market logs"
                          placeholder="Например: B:\Documents\EVE\logs\marketlogs"
                          onChange={ (e) => setMarketLogsPath(e.target.value) }
                          className="w-full rounded border border-eve-border/65 bg-eve-bg/85 px-1.5 py-1 font-mono text-[10px] text-eve-bright outline-none ring-eve-accent/35 focus-visible:ring-[1px]"
                        />
                      </div>
                    )}
                    </>
                    )}
                    {settingsTab === 'interface' && (
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
                    )}
                  </div>
                </div>
              )}
            </div>
            </div>
            </div>
            <h1 className="font-eve min-w-0 self-center justify-self-center text-center leading-none lg:col-start-2 lg:row-start-1">
              <span className="inline-grid w-max min-w-0 max-w-full justify-items-stretch">
                <span className="text-left text-xl font-bold uppercase tracking-[0.1em] sm:text-3xl sm:tracking-[0.14em]">
                  <span className="eve-title-gold-shine">Excel Online</span>
                </span>
                <span className="sr-only">Market</span>
                <div
                  className="mx-auto mt-0.5 flex w-[calc(100%-12px)] min-w-0 items-baseline justify-between text-[11px] font-bold uppercase text-eve-bright/95 [text-shadow:0_0_12px_rgba(236,238,242,0.08)] sm:mt-1 sm:w-[calc(100%-20px)] sm:text-base"
                  aria-hidden="true"
                >
                  { 'Market'.split('').map((ch) => (
                    <span key={ ch } className="inline-block leading-none">
                      { ch }
                    </span>
                  )) }
                </div>
              </span>
            </h1>
          </div>
        </header>
        <div className="relative z-0 flex min-h-0 flex-1 flex-col">
          { tab === 'trading' ? (
            <TradingView
              brokerFeePct={ brokerFeePct }
              salesTaxPct={ salesTaxPct }
              marketLogsPath={ marketLogsPath }
            />
          ) : (
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
