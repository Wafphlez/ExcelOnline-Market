/**
 * Кеш выгрузок .xlsx/.xls в браузере (IndexedDB).
 * localStorage для книг мал. Импорт и результат ESI пишутся сюда и в dev, и в проде,
 * чтобы между выгрузками можно было переключаться после перезагрузки страницы.
 */

export const EXPORT_CACHE_MAX_FILES = 20
/** Суммарный потолок. Только что сохранённый файл остаётся, даже если он один больше лимита. */
export const EXPORT_CACHE_MAX_BYTES = 200 * 1024 * 1024

export const EXPORT_CACHE_CLEARED_EVENT = 'excelmarket:export-cache-cleared'

const DB_NAME = 'excelMarketExportCache'
const DB_VERSION = 1
const META_STORE = 'meta'
const BLOB_STORE = 'blobs'

export type ExportCacheMeta = {
  name: string
  size: number
  mtime: string
}

type ExportCacheLimits = {
  maxFiles: number
  maxBytes: number
}

/**
 * Кого вытеснить перед записью `incoming`.
 * Имя из `incoming` не удаляется: запись с тем же именем просто заменяется.
 * Старые файлы отсекаются с конца, пока не влезут и число, и суммарный размер.
 */
export function pickCacheEvictions(
  existing: readonly ExportCacheMeta[],
  incoming: ExportCacheMeta,
  limits: ExportCacheLimits
): string[] {
  const rest = existing.filter((item) => item.name !== incoming.name)
  const newestFirst = [...rest].sort(
    (a, b) => b.mtime.localeCompare(a.mtime) || a.name.localeCompare(b.name)
  )
  const keep = new Set<string>([incoming.name])
  let bytes = incoming.size
  for (const item of newestFirst) {
    if (keep.size >= limits.maxFiles) break
    if (bytes + item.size > limits.maxBytes) break
    keep.add(item.name)
    bytes += item.size
  }
  return existing.filter((item) => !keep.has(item.name)).map((item) => item.name)
}

let dbPromise: Promise<IDBDatabase> | null = null

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB'))
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB abort'))
  })
}

/** Дожидается и запроса, и транзакции, чтобы отказ одного не остался необработанным. */
async function finishRequest<T>(done: Promise<void>, work: Promise<T>): Promise<T> {
  try {
    const value = await work
    await done
    return value
  } catch (error) {
    await done.catch(() => undefined)
    throw error
  }
}

function openExportCacheDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Кеш браузера недоступен'))
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: 'name' })
        }
        if (!db.objectStoreNames.contains(BLOB_STORE)) {
          db.createObjectStore(BLOB_STORE, { keyPath: 'name' })
        }
      }
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => {
          db.close()
          dbPromise = null
        }
        resolve(db)
      }
      request.onerror = () => {
        dbPromise = null
        reject(request.error ?? new Error('Кеш браузера недоступен'))
      }
    })
  }
  return dbPromise
}

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = 'name' in error ? String(error.name) : ''
  return name === 'QuotaExceededError'
}

function cacheWriteErrorMessage(error: unknown): string {
  if (isQuotaError(error)) {
    return 'Кеш браузера переполнен — удалите старые выгрузки.'
  }
  if (error instanceof Error && error.message) return error.message
  return 'Не удалось записать файл в кеш браузера.'
}

export async function listCachedExportWorkbooks(): Promise<ExportCacheMeta[]> {
  const db = await openExportCacheDb()
  const tx = db.transaction(META_STORE, 'readonly')
  const done = transactionDone(tx)
  return finishRequest(
    done,
    requestToPromise(tx.objectStore(META_STORE).getAll() as IDBRequest<ExportCacheMeta[]>)
  )
}

export async function getCachedExportWorkbook(name: string): Promise<ArrayBuffer | null> {
  const db = await openExportCacheDb()
  const tx = db.transaction(BLOB_STORE, 'readonly')
  const done = transactionDone(tx)
  const row = await finishRequest(
    done,
    requestToPromise(
      tx.objectStore(BLOB_STORE).get(name) as IDBRequest<
        { name: string; buffer: ArrayBuffer } | undefined
      >
    )
  )
  return row?.buffer ?? null
}

export async function putCachedExportWorkbook(
  name: string,
  buffer: ArrayBuffer
): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Пустое имя файла')
  if (!/\.(xlsx|xls)$/i.test(trimmed)) {
    throw new Error('В кеш можно записать только .xlsx или .xls')
  }
  const copy = buffer.slice(0)
  let done: Promise<void> | null = null
  try {
    const db = await openExportCacheDb()
    const tx = db.transaction([META_STORE, BLOB_STORE], 'readwrite')
    done = transactionDone(tx)
    const metaStore = tx.objectStore(META_STORE)
    const blobStore = tx.objectStore(BLOB_STORE)
    const existing = await requestToPromise(
      metaStore.getAll() as IDBRequest<ExportCacheMeta[]>
    )
    const incoming: ExportCacheMeta = {
      name: trimmed,
      size: copy.byteLength,
      mtime: new Date().toISOString(),
    }
    const drop = pickCacheEvictions(existing, incoming, {
      maxFiles: EXPORT_CACHE_MAX_FILES,
      maxBytes: EXPORT_CACHE_MAX_BYTES,
    })
    for (const staleName of drop) {
      metaStore.delete(staleName)
      blobStore.delete(staleName)
    }
    metaStore.put(incoming)
    blobStore.put({ name: trimmed, buffer: copy })
    await done
  } catch (error) {
    await done?.catch(() => undefined)
    throw new Error(cacheWriteErrorMessage(error))
  }
}

export async function deleteCachedExportWorkbook(name: string): Promise<void> {
  const db = await openExportCacheDb()
  const tx = db.transaction([META_STORE, BLOB_STORE], 'readwrite')
  const done = transactionDone(tx)
  tx.objectStore(META_STORE).delete(name)
  tx.objectStore(BLOB_STORE).delete(name)
  await done
}

/** Стирает все сохранённые выгрузки и сообщает открытым экранам обновить список. */
export async function clearCachedExportWorkbooks(): Promise<void> {
  let done: Promise<void> | null = null
  try {
    const db = await openExportCacheDb()
    const tx = db.transaction([META_STORE, BLOB_STORE], 'readwrite')
    done = transactionDone(tx)
    tx.objectStore(META_STORE).clear()
    tx.objectStore(BLOB_STORE).clear()
    await done
  } catch (error) {
    await done?.catch(() => undefined)
    throw new Error(
      error instanceof Error && error.message
        ? error.message
        : 'Не удалось удалить выгрузки из кеша браузера.'
    )
  }
  globalThis.dispatchEvent(new Event(EXPORT_CACHE_CLEARED_EVENT))
}
