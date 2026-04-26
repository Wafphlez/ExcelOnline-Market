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
   * Режим «все страницы ордеров» (`orderPagesUntilExhausted: true` в опциях экспорта) — влияет
   * **только** на пагинацию /markets/…/orders/. Тогда `maxOrderPages` в прогрессе = потолок ESI
   * (1000) для шкалы, не 0; авто-стоп по 404, пустому ответу, неполной странице, как в bounded.
   */
  unboundedOrderPages: boolean
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
  /** Запросы /universe/types/{id}/ (только реальные HTTP, не cache-hit). */
  universeTypesDone: number
  universeTypesTotal: number
  /** Запросы /universe/groups/{id}/ (реальные HTTP). */
  universeGroupsDone: number
  universeGroupsTotal: number
  /** Запросы /universe/categories/{id}/ (реальные HTTP). */
  universeCategoriesDone: number
  universeCategoriesTotal: number
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
  orderSellPageBarMax: 0,
  orderBuyPageBarMax: 0,
  historyDone: 0,
  historyTotal: 0,
  universeTypesDone: 0,
  universeTypesTotal: 0,
  universeGroupsDone: 0,
  universeGroupsTotal: 0,
  universeCategoriesDone: 0,
  universeCategoriesTotal: 0,
}
