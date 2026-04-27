import { useCallback, useEffect, useState } from 'react'
import
  {
    fetchAllAssets,
    fetchAllWalletJournal,
    fetchAllWalletTransactions,
    fetchCharacterWallet,
    fetchCorporation,
    fetchMarketPrices,
    fetchPublicCharacter,
  } from '../lib/eve/characterEsi'
import { loadActiveMarketOrdersData, type ActiveMarketOrdersData } from '../lib/eve/activeMarketOrders'
import
  {
    aggregateAssetQuantities,
    aggregateTradesByDay,
    buildNetWorthOverlayPoints,
    buildWalletBalanceSeries,
    pricesToMap,
    valueAssets,
    type TimePoint,
    type TradeDayAgg,
  } from '../lib/eve/capitalMetrics'
import { getStoredCharacterId } from '../lib/eve/authStore'
import { ensureValidAccessToken } from '../lib/eve/eveSso'
import type { EveCharacterInfo, EveCorporation } from '../types/eveCharacter'
import type { EveWalletJournalEntry, EveWalletTransaction } from '../types/eveCharacter'

export type CharacterDashboardState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'unauthorized'; message: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: CharacterDashboardBundle }

export type CharacterDashboardBundle = {
  characterId: number
  character: EveCharacterInfo
  corporation: EveCorporation | null
  wallet: number
  journal: EveWalletJournalEntry[]
  transactions: EveWalletTransaction[]
  assetsValue: number
  netWorth: number
  walletSeries: TimePoint[]
  netWorthSeries: { time: string; wallet: number; netWorth: number }[]
  tradeByDay: TradeDayAgg[]
  activeMarketOrders: ActiveMarketOrdersData | null
  activeMarketOrdersError: string | null
}

export function useCharacterDashboardData(
  enabled: boolean
): {
  state: CharacterDashboardState
  refresh: () => void
}
{
  const [state, setState] = useState<CharacterDashboardState>({ status: 'idle' })
  const [version, setVersion] = useState(0)

  const refresh = useCallback(() =>
  {
    setVersion((n) => n + 1)
  }, [])

  useEffect(() =>
  {
    if (!enabled) return
    const ac = new AbortController()
    setState({ status: 'loading' })
    void (async () =>
    {
      const token = await ensureValidAccessToken()
      if (ac.signal.aborted) return
      if (!token)
      {
        setState({
          status: 'unauthorized',
          message: 'Войдите через EVE SSO (кнопка на вкладке «Персонаж»).',
        })
        return
      }
      const characterId = getStoredCharacterId()
      if (!characterId)
      {
        setState({
          status: 'unauthorized',
          message: 'Не найден character_id — выполните вход заново.',
        })
        return
      }
      try
      {
        const [wallet, character, journal, transactions, assets] = await Promise.all([
          fetchCharacterWallet(characterId, token),
          fetchPublicCharacter(characterId),
          fetchAllWalletJournal(characterId, token, ac.signal),
          fetchAllWalletTransactions(characterId, token, ac.signal),
          fetchAllAssets(characterId, token, ac.signal),
        ])
        if (ac.signal.aborted) return
        let corporation: EveCorporation | null = null
        if (character.corporation_id)
        {
          try
          {
            corporation = await fetchCorporation(character.corporation_id)
          } catch
          {
            corporation = null
          }
        }
        const byType = aggregateAssetQuantities(assets)
        const typeIds = [...byType.keys()]
        const pricesList = await fetchMarketPrices(typeIds, ac.signal)
        if (ac.signal.aborted) return
        const priceMap = pricesToMap(pricesList)
        const assetsValue = valueAssets(byType, priceMap)
        const netWorth = wallet + assetsValue
        const walletSeries = buildWalletBalanceSeries(journal)
        const netWorthSeries = buildNetWorthOverlayPoints(walletSeries, assetsValue)
        const tradeByDay = aggregateTradesByDay(transactions)
        const info: EveCharacterInfo = {
          ...character,
          character_id: characterId,
        }
        let activeMarketOrders: ActiveMarketOrdersData | null = null
        let activeMarketOrdersError: string | null = null
        try
        {
          activeMarketOrders = await loadActiveMarketOrdersData(
            characterId,
            token,
            ac.signal
          )
        } catch (e)
        {
          activeMarketOrdersError = e instanceof Error ? e.message : 'Ордера: ошибка ESI'
        }
        if (ac.signal.aborted) return
        setState({
          status: 'ready',
          data: {
            characterId,
            character: info,
            corporation,
            wallet,
            journal,
            transactions,
            assetsValue,
            netWorth,
            walletSeries,
            netWorthSeries,
            tradeByDay,
            activeMarketOrders,
            activeMarketOrdersError,
          },
        })
      } catch (e)
      {
        if (ac.signal.aborted) return
        setState({
          status: 'error',
          message: e instanceof Error ? e.message : 'Ошибка загрузки ESI',
        })
      }
    })()
    return () => ac.abort()
  }, [enabled, version])

  return { state, refresh }
}

export type { TradeDayAgg }
