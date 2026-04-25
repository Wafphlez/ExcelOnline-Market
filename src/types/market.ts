export type MarketRow = {
  /** EVE type id для ссылок (например EVE Tycoon); в файле опционален */
  typeId: number | null
  /** Текстовый тип/категория предмета (например ship, module, ammo) */
  type: string
  name: string
  dayVolume: number
  dayTurnover: number
  price: number
  priceSell: number
  priceBuy: number
  margin: number | null
  buyToSellRatio: number | null
  spreadIsk: number | null
  /** 0–100, оценка выгодности входа (абс. шкалы, не «макс. в файле») */
  entryScore: number | null
}

export type RawWorkbookResult = {
  sheetName: string
  rows: Record<string, unknown>[]
}
