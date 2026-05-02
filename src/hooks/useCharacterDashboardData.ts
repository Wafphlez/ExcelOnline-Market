import
  {
    useCallback,
    useEffect,
    useState,
    type Dispatch,
    type SetStateAction,
  } from 'react'
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
    valuePlexInAssets,
    type TimePoint,
    type TradeDayAgg,
  } from '../lib/eve/capitalMetrics'
import { getStoredCharacterId } from '../lib/eve/authStore'
import { ensureValidAccessToken } from '../lib/eve/eveSso'
import type
  {
    EveCharacterInfo,
    EveCorporation,
    EveWalletJournalEntry,
    EveWalletTransaction,
  } from '../types/eveCharacter'

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
  /** ISK в эскроу активных buy-ордеров (как в клиенте: «рынок»). */
  marketEscrowIsk: number
  /**
   * Оценка PLEX в инвентаре ESI; уже вошла в `assetsValue` — для подписи к тултипу клиента.
   */
  plexValueInAssetsIsk: number
  walletSeries: TimePoint[]
  netWorthSeries: { time: string; wallet: number; netWorth: number }[]
  tradeByDay: TradeDayAgg[]
  activeMarketOrders: ActiveMarketOrdersData | null
  activeMarketOrdersError: string | null
}

async function fetchCharacterDashboardBundle(
  characterId: number,
  token: string,
  signal: AbortSignal
): Promise<CharacterDashboardBundle>
{
  const [wallet, character, journal, transactions, assets] = await Promise.all([
    fetchCharacterWallet(characterId, token),
    fetchPublicCharacter(characterId),
    fetchAllWalletJournal(characterId, token, signal),
    fetchAllWalletTransactions(characterId, token, signal),
    fetchAllAssets(characterId, token, signal),
  ])
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
  const pricesList = await fetchMarketPrices(typeIds, signal)
  const priceMap = pricesToMap(pricesList)
  const assetsValue = valueAssets(byType, priceMap)
  const plexValueInAssetsIsk = valuePlexInAssets(byType, priceMap)
  const walletSeries = buildWalletBalanceSeries(journal)
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
      signal
    )
  } catch (e)
  {
    activeMarketOrdersError = e instanceof Error ? e.message : 'Ордера: ошибка ESI'
  }
  const marketEscrowIsk = activeMarketOrders?.buyTotalEscrowIsk ?? 0
  const netWorth = wallet + assetsValue + marketEscrowIsk
  const netWorthSeries = buildNetWorthOverlayPoints(
    walletSeries,
    assetsValue,
    marketEscrowIsk
  )
  return {
    characterId,
    character: info,
    corporation,
    wallet,
    journal,
    transactions,
    assetsValue,
    netWorth,
    marketEscrowIsk,
    plexValueInAssetsIsk,
    walletSeries,
    netWorthSeries,
    tradeByDay,
    activeMarketOrders,
    activeMarketOrdersError,
  }
}

function patchReadyActiveOrdersError(
  prev: CharacterDashboardState,
  message: string
): CharacterDashboardState
{
  if (prev.status !== 'ready') return prev
  return {
    status: 'ready',
    data: {
      ...prev.data,
      activeMarketOrdersError: message,
    },
  }
}

function mergeRefreshedActiveMarketOrders(
  prev: CharacterDashboardState,
  activeMarketOrders: ActiveMarketOrdersData | null
): CharacterDashboardState
{
  if (prev.status !== 'ready') return prev
  const marketEscrowIsk = activeMarketOrders?.buyTotalEscrowIsk ?? 0
  const netWorth = prev.data.wallet + prev.data.assetsValue + marketEscrowIsk
  const netWorthSeries = buildNetWorthOverlayPoints(
    prev.data.walletSeries,
    prev.data.assetsValue,
    marketEscrowIsk
  )
  return {
    status: 'ready',
    data: {
      ...prev.data,
      activeMarketOrders,
      activeMarketOrdersError: null,
      marketEscrowIsk,
      netWorth,
      netWorthSeries,
    },
  }
}

async function runActiveMarketOrdersRefresh(
  characterId: number | null,
  setState: Dispatch<SetStateAction<CharacterDashboardState>>
): Promise<void>
{
  try
  {
    const token = await ensureValidAccessToken()
    if (token)
    {
      if (characterId)
      {
        const activeMarketOrders = await loadActiveMarketOrdersData(
          characterId,
          token,
          undefined
        )
        setState((prev) =>
          mergeRefreshedActiveMarketOrders(prev, activeMarketOrders)
        )
        return
      }
      setState((prev) =>
        patchReadyActiveOrdersError(
          prev,
          'Не найден character_id — выполните вход заново.'
        )
      )
      return
    }
    setState((prev) =>
      patchReadyActiveOrdersError(
        prev,
        'Войдите через EVE SSO, чтобы обновить активные ордера.'
      )
    )
  } catch (e)
  {
    setState((prev) =>
      patchReadyActiveOrdersError(
        prev,
        e instanceof Error ? e.message : 'Ордера: ошибка ESI'
      )
    )
  }
}

export function useCharacterDashboardData(
  enabled: boolean
): {
  state: CharacterDashboardState
  refresh: () => void
  refreshActiveMarketOrders: () => void
  activeMarketOrdersRefreshing: boolean
}
{
  const [state, setState] = useState<CharacterDashboardState>({ status: 'idle' })
  const [version, setVersion] = useState(0)
  const [activeMarketOrdersRefreshing, setActiveMarketOrdersRefreshing] = useState(false)

  const refresh = useCallback(() =>
  {
    setVersion((n) => n + 1)
  }, [])

  const refreshActiveMarketOrders = useCallback(() =>
  {
    if (state.status !== 'ready' || activeMarketOrdersRefreshing) return
    const characterId = prevCharacterId(state)
    setActiveMarketOrdersRefreshing(true)
    void runActiveMarketOrdersRefresh(characterId, setState).finally(() =>
    {
      setActiveMarketOrdersRefreshing(false)
    })
  }, [activeMarketOrdersRefreshing, state])

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
        const data = await fetchCharacterDashboardBundle(
          characterId,
          token,
          ac.signal
        )
        if (ac.signal.aborted) return
        setState({ status: 'ready', data })
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

  return { state, refresh, refreshActiveMarketOrders, activeMarketOrdersRefreshing }
}

function prevCharacterId(state: CharacterDashboardState): number | null
{
  if (state.status === 'ready') return state.data.characterId
  return getStoredCharacterId()
}

export type { TradeDayAgg } from '../lib/eve/capitalMetrics'
