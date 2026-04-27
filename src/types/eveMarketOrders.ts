/** GET /characters/{id}/orders/ (ESI) */
export type EsiCharacterOrder = {
  order_id: number
  type_id: number
  location_id: number
  is_buy_order: boolean
  price: number
  volume_total: number
  volume_remain: number
  min_volume: number
  range?: string | number
  duration: number
  issued: string
  /** обычно `active` у выдачи «текущие» ордера */
  state?: string
  is_corporation?: boolean
}

/** GET /markets/{region}/orders/ (ESI) */
export type EsiRegionalOrderRow = {
  order_id: number
  type_id: number
  price: number
  volume: number
  is_buy_order: boolean
  location_id: number
  /** не всегда в ответе */
  duration?: number
  issued?: string
  min_volume?: number
  range?: string | number
}
