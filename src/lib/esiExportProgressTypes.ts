/** Раздельный модуль типов — импорт в UI без node-зависимостей. */
export type EsiExportProgressState = {
  phase: 'idle' | 'orders' | 'types'
  maxOrderPages: number
  /** Текущая страница sell (1..max), 0 = ещё не старт. */
  sellPage: number
  /** Текущая страница buy. */
  buyPage: number
  typeTotal: number
  /** Сколько слотов типов завершено (параллельные async). */
  typesDone: number
  /** В фазе `types` обычно = `typeTotal` (все типы — параллельные async). */
  typeConcurrency: number
  /**
   * Знаменатель шкалы Sell: 0 = брать `maxOrderPages` (ещё качаем или весь лимит).
   * >0 = фактическое число страниц по sell (конец пагинации, 404 «нет страницы», …).
   */
  orderSellPageBarMax: number
  /** То же для Buy. */
  orderBuyPageBarMax: number
  /** Запросы /markets/{region}/history/?type_id=... */
  historyDone: number
  historyTotal: number
  /** Snapshot ордеров для выгрузки (top-of-book + sheet orders_snapshot). */
  snapshotDone: number
  snapshotTotal: number
}

export const ESI_EXPORT_PROGRESS_IDLE: EsiExportProgressState = {
  phase: 'idle',
  maxOrderPages: 0,
  sellPage: 0,
  buyPage: 0,
  typeTotal: 0,
  typesDone: 0,
  typeConcurrency: 0,
  orderSellPageBarMax: 0,
  orderBuyPageBarMax: 0,
  historyDone: 0,
  historyTotal: 0,
  snapshotDone: 0,
  snapshotTotal: 0,
}
