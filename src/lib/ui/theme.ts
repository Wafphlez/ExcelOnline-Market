export const APP_THEME_STORAGE_KEY = 'excelMarket_uiTheme'

export const APP_THEMES = ['photon', 'cyan', 'violet', 'amber'] as const

export type AppThemeId = (typeof APP_THEMES)[number]

const DEFAULT_THEME: AppThemeId = 'photon'

export function isAppThemeId(value: unknown): value is AppThemeId {
  return typeof value === 'string' && APP_THEMES.includes(value as AppThemeId)
}

export function readStoredAppTheme(): AppThemeId {
  try {
    const raw = localStorage.getItem(APP_THEME_STORAGE_KEY)
    return isAppThemeId(raw) ? raw : DEFAULT_THEME
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
    case 'photon':
      return 'Photon'
    case 'cyan':
      return 'Cyan'
    case 'violet':
      return 'Violet'
    case 'amber':
      return 'Amber'
    default:
      return theme
  }
}
