import type { MarketRow } from '../types/market'

/** Стабильный ключ строки для «скопировано» до смены файла (не привязан к сортировке). */
export function marketRowCopyKey(r: MarketRow): string {
  return [
    r.name,
    r.typeId ?? '',
    r.price,
    r.priceBuy,
    r.priceSell,
    r.dayTurnover,
    r.dayVolume,
  ].join('\u{1E}')
}
