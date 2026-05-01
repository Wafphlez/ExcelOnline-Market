import
  {
    EVE_SSO_OFFICIAL_LOGIN_BUTTONS,
    EVE_SSO_SCOPES_INFO,
  } from '../../lib/eve/constants'

type EveSsoLoginPanelProps = Readonly<{
  onLogin: () => void
  disabled: boolean
}>

/**
 * Кнопка и блок scopes по гайдлайнам CCP: официальное изображение + явное перечисление разрешений.
 * @see https://docs.esi.evetech.net/docs/sso
 */
export function EveSsoLoginPanel(
  { onLogin, disabled }: EveSsoLoginPanelProps
): JSX.Element
{
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
      <div className="shrink-0">
        <button
          type="button"
          onClick={ onLogin }
          disabled={ disabled }
          className="group block max-w-full rounded p-0 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-eve-surface enabled:hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
          title="Перейти к авторизации EVE SSO (логин и выбор персонажа на login.eveonline.com)"
        >
          <img
            src={ EVE_SSO_OFFICIAL_LOGIN_BUTTONS.largeWhite }
            width={ 360 }
            height={ 64 }
            className="h-auto max-w-full"
            alt="LOG IN with EVE Online"
            loading="eager"
            decoding="async"
            draggable={ false }
          />
        </button>
        <p className="mt-1.5 max-w-[20rem] text-[10px] leading-snug text-eve-muted/80">
          Используется официальная графика CCP для EVE SSO. Аккаунт и пароль вводятся только на
          { ' ' }
          <span className="whitespace-nowrap">login.eveonline.com</span>
          { ' ' }
          — приложению известен только токен с выбранными вами scope.
        </p>
      </div>

      <div className="min-w-0 flex-1 rounded border border-eve-border/40 bg-eve-bg/30 p-2.5 shadow-eve-inset">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-eve-gold/90">
          Запрашиваемые разрешения (ESI scopes)
        </p>
        <p className="mb-2 mt-0.5 text-[10px] text-eve-muted/90">
          На экране CCP вы увидите тот же список; можно отклонить или принять весь набор.
        </p>
        <ul className="space-y-2">
          { EVE_SSO_SCOPES_INFO.map((row) => (
            <li
              key={ row.scope }
              className="border-t border-eve-border/25 pt-2 first:border-t-0 first:pt-0"
            >
              <p className="text-[10px] font-mono break-all text-eve-cyan/90">
                { row.scope }
              </p>
              <p className="text-xs font-semibold text-eve-bright/95">
                { row.title }
              </p>
              <p className="text-[11px] leading-snug text-eve-muted/95">
                { row.details }
              </p>
            </li>
          )) }
        </ul>
        <a
          href="https://developers.eveonline.com/docs/services/sso/"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-[10px] text-eve-accent/90 underline decoration-eve-border hover:text-eve-bright"
        >
          Документация CCP: EVE Single Sign-On
        </a>
      </div>
    </div>
  )
}
