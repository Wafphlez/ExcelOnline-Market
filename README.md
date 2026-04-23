# Excel Online Market

Веб-таблица для анализа выгрузок рынка EVE (Excel): метрики, фильтры, сортировка, экспорты в dev.

## Требования

- [Node.js](https://nodejs.org/) 18+ (для `npm` и локального dev)

## Быстрый старт

```bash
npm install
npm run dev
```

Откройте в браузере адрес, который выведет Vite (обычно `http://localhost:5173`).

## Скрипты

| Команда | Назначение |
|--------|------------|
| `npm run dev` | Режим разработки, hot reload |
| `npm run build` | Сборка в `dist/` |
| `npm run preview` | Просмотр production-сборки |
| `npm test` | Запуск тестов (Vitest) |

## Экспорты в папку `exports/` (только `npm run dev`)

Кнопки скачивания регионов пишут `.xlsx` в `exports/`, сценарий «загрузить в таблицу» и сохранение `filters.json` работают при запуске через Vite, не в статической выкладке.

### Выгрузка через официальный ESI (dev)

Кнопка **«Сформировать (ESI)»** для выбранного региона вызывает `POST /__dev/export/esi-liquidity`: Vite middleware тянет данные с `https://esi.evetech.net/latest` (ордера, история по типам, названия предметов), собирает таблицу в формате, совместимом с парсером ([`src/lib/dev/esiLiquidityExport.ts`](src/lib/dev/esiLiquidityExport.ts)), сохраняет `exports/liquidity-esi-{regionId}.xlsx` и открывает её в приложении. Запрос может занять **1–3+ минуты**; при HTTP 420/503 используются паузы (ограничение CCP).

В production-сборке эта кнопка скрыта — для публичного хоста нужен отдельный бэкенд с тем же пайплайном.

Ручной `fetch` к `POST /__dev/export/esi-liquidity` допустим; ответ приходит **после** длительного опроса ESI (часто **1–3+ мин**). Сокет в dev настроен на длинный таймаут. Для CORS: страница и URL запроса должны совпадать по **origin** (не смешивайте `localhost` и `127.0.0.1` в одной вкладке) — для путей `__dev` добавлены заголовки `Access-Control-Allow-Origin` по `Origin` запроса.

## Стек

React, TypeScript, Vite, TanStack Table, xlsx, Tailwind (см. `package.json`).
