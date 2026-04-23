/** Раздельный модуль типов — импорт в UI без node-зависимостей. */
export type EsiExportProgressState = {
  phase: 'idle' | 'orders' | 'types'
  maxOrderPages: number
  /** Текущая страница sell (1..max), 0 = ещё не старт. */
  sellPage: number
  /** Текущая страница buy. */
  buyPage: number
  typeTotal: number
  /** Сколько типов обработано (в т.ч. при параллельных батчах). */
  typesDone: number
  /** Сколько типов в одном батче (параллельно). */
  typeConcurrency: number
  /**
   * Режим «все страницы ордеров, пока ESI не ответит "нет страницы"».
   * Тогда `maxOrderPages` = 0 (неизвестно), прогресс не по макс. числу страниц.
   */
  unboundedOrderPages: boolean
}

export const ESI_EXPORT_PROGRESS_IDLE: EsiExportProgressState = {
  phase: 'idle',
  maxOrderPages: 0,
  sellPage: 0,
  buyPage: 0,
  typeTotal: 0,
  typesDone: 0,
  typeConcurrency: 0,
  unboundedOrderPages: false,
}
