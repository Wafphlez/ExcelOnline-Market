/** Макс. страниц ордеров (на сторону sell / buy) в UI и в POST /__dev/export/esi-liquidity. */
export const ESI_MAX_ORDER_PAGES_USER_CAP = 1000

/**
 * Пауза между **стартами** запросов страниц **одной** стороны (сек) в bounded-режиме
 * (`orderPagesUntilExhausted: false`). **Одна** константа и для `order_type=sell`, и для
 * `order_type=buy` (обе ветки — `fetchOrderBookSideStaggered` с тем же `STAGGER_MS`).
 * `0` — все страницы sell и buy стартуют сразу, без 1с между p=1,2,…
 */
export const ESI_ORDER_PAGE_STAGGER_SEC = 0

/**
 * Сколько типов (строк) брать в ESI-отчёт — топ по активности в стакане; совпадает
 * с порядком величины полноразмерных выгрузок (см. liquidity-domain.xlsx).
 */
export const ESI_DEFAULT_MAX_TYPES = 8001

/** Верхняя граница `maxTypes` в UI и в POST /esi-liquidity. */
export const ESI_MAX_TYPES_USER_CAP = 12_000
