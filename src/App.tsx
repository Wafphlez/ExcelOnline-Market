import { useEffect, useState } from 'react'
import { CharacterDashboard } from './components/character/CharacterDashboard'
import { tryFinishOAuthOnLoad } from './lib/eve/eveSso'
import TradingView from './views/TradingView'

type AppTab = 'trading' | 'character'

function TabButton(
  { active, children, onClick }: {
    active: boolean
    children: string
    onClick: () => void
  }
): JSX.Element
{
  return (
    <button
      type="button"
      onClick={ onClick }
      className={ `rounded border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 focus-visible:ring-offset-1 focus-visible:ring-offset-eve-surface ${
        active
          ? 'border-eve-accent bg-eve-accent-muted text-eve-accent shadow-[inset_0_0_0_1px_rgba(184,150,61,0.2)]'
          : 'border-eve-border/80 text-eve-muted hover:border-eve-accent/40 hover:text-eve-bright'
      }` }
    >
      { children }
    </button>
  )
}

export default function App(): JSX.Element
{
  const [tab, setTab] = useState<AppTab>('trading')
  const [bootMessage, setBootMessage] = useState<string | null>(null)

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
    <div className="min-h-screen eve-ui-root text-white lg:h-screen lg:overflow-hidden lg:flex lg:flex-col">
      <div className="shrink-0 border-b border-eve-border/40 bg-eve-bg/40 px-4 py-2">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-2">
          <span className="mr-2 text-[10px] font-bold uppercase tracking-[0.2em] text-eve-muted/80">
            Раздел
          </span>
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
  )
}
