import type { MarketRow } from '../types/market'

export type ColumnId = keyof MarketRow

export type ColumnLabelDef = {
  id: ColumnId
  short: string
  description: string
  /** 0 = integer, 1-4 = isk/percent */
  kind: 'text' | 'int' | 'isk' | 'percent' | 'ratio' | 'score' | 'spreadBar' | 'market'
}

export const COLUMN_DEFS: ColumnLabelDef[] = [
  {
    id: 'typeId',
    short: 'Мркт',
    description:
      'EVE Tycoon: открыть карточку рынка по type id. Нужна колонка type id в выгрузке.',
    kind: 'market',
  },
  {
    id: 'name',
    short: 'Название предмета',
    description: 'Как в выгрузке рынка. Клик — копировать название.',
    kind: 'text',
  },
  {
    id: 'type',
    short: 'Тип предмета',
    description:
      'Текстовый тип/категория (например ship, module). Поддерживает текстовый фильтр с подсказками.',
    kind: 'text',
  },
  {
    id: 'dayVolume',
    short: 'Сделок за сутки',
    description: 'Объём сделок за период (шт.).',
    kind: 'int',
  },
  {
    id: 'dayTurnover',
    short: 'Оборот за сутки, ISK',
    description:
      'В файле оборот часто в миллионах ISK; в таблице показаны полные ISK.',
    kind: 'isk',
  },
  {
    id: 'packagedVolume',
    short: 'Объём перевозки, м3',
    description:
      'Объём при перевозке в м3 за единицу товара; для кораблей используется packaged volume.',
    kind: 'ratio',
  },
  {
    id: 'price',
    short: 'Средняя цена, ISK',
    description: 'Средняя/типичная цена (как в файле), ISK.',
    kind: 'isk',
  },
  {
    id: 'priceSell',
    short: 'Sell, ISK',
    description:
      'Мин. цена продажи (ask): самый дешёвый текущий ордер на продажу.',
    kind: 'isk',
  },
  {
    id: 'priceBuy',
    short: 'Buy, ISK',
    description:
      'Макс. цена покупки (bid): самый дорогой текущий ордер на покупку.',
    kind: 'isk',
  },
  {
    id: 'margin',
    short: 'Маржа, %',
    description:
      'После комиссий: bid×(1+broker) и ask×(1−tax−broker); (выручка−себестоимость)/ask. Фон по «эквивалентной» марже (см. настройки). 0 % → … → 20 %+. Мин/макс в фильтре — в процентах, как в ячейке.',
    kind: 'percent',
  },
  {
    id: 'buyToSellRatio',
    short: 'Средняя в спреде',
    description:
      'Позиция средней цены на оси bid…ask (маркер на шкале). Под шкалой — условное разбиение числа сделок за период по сторонам спреда: sell ≈ round(V×доля к sell), buy = V − sell; при доле 0,5 пополам. Фильтр макс/мин — в % по оси: 0 = buy, 100 = sell.',
    kind: 'spreadBar',
  },
  {
    id: 'spreadIsk',
    short: 'Спред, ISK',
    description: 'Абсолютная ширина спреда: ask − bid на единицу товара.',
    kind: 'isk',
  },
  {
    id: 'entryScore',
    short: 'Выгодность входа',
    description:
      '0–100 %: полоска заполняется слева; маржа, ликвидность, спред. Выше порога цены 1 ед. вклад маржи слабее. Без сделок/оборота — занижение. Фильтр в тех же %.',
    kind: 'score',
  },
]

export const COLUMN_DEF_BY_ID = Object.fromEntries(
  COLUMN_DEFS.map((c) => [c.id, c])
) as Record<ColumnId, ColumnLabelDef>
