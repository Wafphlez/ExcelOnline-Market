export type EveCharacterInfo = {
  character_id: number
  name: string
  corporation_id?: number
  alliance_id?: number
  birthday?: string
  description?: string
  gender?: string
  race_id?: number
  bloodline_id?: number
  ancestry_id?: number
  security_status?: number
}

export type EveCorporation = {
  corporation_id: number
  name: string
  ticker: string
  description?: string
  alliance_id?: number
  ceo_id?: number
  member_count?: number
}

export type EveWalletJournalEntry = {
  id: number
  date: string
  ref_type: string
  ref_id?: number
  /** Контекст (напр. `market_transaction_id` для налога/комиссии) — ESI. */
  context_id?: number
  context_id_type?: string
  first_party_id?: number
  second_party_id?: number
  amount: number
  balance?: number
  description?: string
  reason?: string
  tax?: number
  tax_receiver_id?: number
  extra_info?: unknown
}

export type EveWalletTransaction = {
  transaction_id: number
  date: string
  type_id: number
  location_id: number
  unit_price: number
  quantity: number
  client_id: number
  is_buy: boolean
  is_personal: boolean
  journal_ref_id?: number
}

export type EveAsset = {
  type_id: number
  item_id: number
  is_singleton: boolean
  location_flag: string
  location_id: number
  location_type: string
  quantity: number
}

export type MarketPrice = {
  type_id: number
  average_price?: number
  adjusted_price?: number
}
