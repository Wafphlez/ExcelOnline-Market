/** EVE Online ESI (tranquility) — базовый URL с сегментом /latest. */
export const ESI_BASE = 'https://esi.evetech.net/latest'

export const EVE_SSO_AUTH_URL = 'https://login.eveonline.com/v2/oauth/authorize'
export const EVE_SSO_TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token'
export const EVE_SSO_VERIFY_URL = 'https://login.eveonline.com/oauth/verify'
export const EVE_IMAGE_BASE = 'https://images.evetech.net'

/**
 * Минимальные scopes для кошелька, журнала, транзакций и оценки активов.
 * @see https://developers.eveonline.com/
 */
export const EVE_SSO_SCOPES = [
  'esi-wallet.read_character_wallet.v1',
  'esi-assets.read_assets.v1',
  'esi-markets.read_character_orders.v1',
] as const

export const EVE_SSO_SCOPES_STRING = EVE_SSO_SCOPES.join(' ')

/**
 * Официальные кнопки CCP для EVE SSO (рекомендация CCP: использовать как есть).
 * @see https://docs.esi.evetech.net/docs/sso — раздел «Login Images»
 */
export const EVE_SSO_OFFICIAL_LOGIN_BUTTONS = {
  largeWhite:
    'https://web.ccpgamescdn.com/eveonlineassets/developers/eve-sso-login-white-large.png',
  largeBlack:
    'https://web.ccpgamescdn.com/eveonlineassets/developers/eve-sso-login-black-large.png',
  smallWhite:
    'https://web.ccpgamescdn.com/eveonlineassets/developers/eve-sso-login-white-small.png',
  smallBlack:
    'https://web.ccpgamescdn.com/eveonlineassets/developers/eve-sso-login-black-small.png',
} as const

export type EveSsoScopeInfo = {
  scope: (typeof EVE_SSO_SCOPES)[number]
  /** Краткое назначение на русском (для игрока) */
  title: string
  /** Что конкретно читает приложение */
  details: string
}

/** Расшифровка scopes — показывать рядом с кнопкой входа. */
export const EVE_SSO_SCOPES_INFO: readonly EveSsoScopeInfo[] = [
  {
    scope: 'esi-wallet.read_character_wallet.v1',
    title: 'Кошелёк и сделки',
    details:
      'Баланс ISK, журнал движений, рыночные транзакции — для графиков капитала и торговой истории.',
  },
  {
    scope: 'esi-assets.read_assets.v1',
    title: 'Имущество',
    details:
      'Список предметов и кораблей персонажа — для оценки капитала (net worth) вместе с кошельком.',
  },
  {
    scope: 'esi-markets.read_character_orders.v1',
    title: 'Рыночные ордера',
    details:
      'Список активных buy/sell-ордеров — блок «Активные Market Orders» и сравнение с книгой региона.',
  },
] as const

export const DEFAULT_EVE_USER_AGENT =
  'ExcelOnlineMarket/1.0 (https://github.com/Wafphlez/ExcelOnline-Market)'

export const ESI_REQUEST_GAP_MS = 25
export const ESI_MAX_RETRIES = 12

export const LS_EVE_REFRESH = 'excelMarket_eveSsoRefreshToken'
export const LS_EVE_CHARACTER_ID = 'excelMarket_eveSsoCharacterId'
export const SS_EVE_ACCESS = 'excelMarket_eveSsoAccessToken'
export const SS_EVE_ACCESS_EXP = 'excelMarket_eveSsoAccessExpMs'

export function getSsoClientId(): string
{
  const v = import.meta.env.VITE_EVE_SSO_CLIENT_ID
  return v !== undefined ? v.trim() : ''
}

/**
 * Должен **байт-в-байт** совпадать с Callback URL в CCP. Часто в портале указывают без
 * завершающего «/» (`http://127.0.0.1:5173`), а `pathname` + «/» давал `...5173/`.
 */
export function getSsoRedirectUri(): string
{
  const v = import.meta.env.VITE_EVE_SSO_REDIRECT_URI
  if (v !== undefined && v.trim().length > 0) return v.trim()
  if (globalThis.window === undefined) return ''
  const { origin, pathname } = globalThis.window.location
  if (pathname === '/' || pathname === '') return origin
  return `${ origin }${ pathname }`
}

export function characterPortraitUrl(characterId: number, size: 64 | 128 | 256 | 512 | 1024 = 256): string
{
  return `${ EVE_IMAGE_BASE }/characters/${ characterId }/portrait?size=${ size }`
}

export function typeIconUrl(typeId: number, size: 32 | 64 | 128 | 256 | 512 | 1024 = 64): string
{
  return `${ EVE_IMAGE_BASE }/types/${ typeId }/icon?size=${ size }`
}
