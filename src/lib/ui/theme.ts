export const APP_THEME_STORAGE_KEY = 'excelMarket_uiTheme'

export const APP_THEMES = ['caldari', 'gallente', 'minmatar', 'amarr'] as const

export type AppThemeId = (typeof APP_THEMES)[number]

const DEFAULT_THEME: AppThemeId = 'amarr'

const LEGACY_THEME_MAP: Record<string, AppThemeId> = {
  photon: 'caldari',
  cyan: 'gallente',
  violet: 'minmatar',
  amber: 'amarr',
}

export function isAppThemeId(value: unknown): value is AppThemeId {
  return typeof value === 'string' && APP_THEMES.includes(value as AppThemeId)
}

export function readStoredAppTheme(): AppThemeId {
  try {
    const raw = localStorage.getItem(APP_THEME_STORAGE_KEY)
    if (isAppThemeId(raw)) return raw
    if (typeof raw === 'string' && raw in LEGACY_THEME_MAP) return LEGACY_THEME_MAP[raw]
    return DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function persistAppTheme(theme: AppThemeId): void {
  try {
    localStorage.setItem(APP_THEME_STORAGE_KEY, theme)
  } catch {
    /* ignore */
  }
}

export function applyAppThemeToDocument(theme: AppThemeId): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
}

export function getAppThemeLabel(theme: AppThemeId): string {
  switch (theme) {
    case 'caldari':
      return 'Caldari'
    case 'gallente':
      return 'Gallente'
    case 'minmatar':
      return 'Minmatar'
    case 'amarr':
      return 'Amarr'
    default:
      return theme
  }
}
