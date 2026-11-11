# Excel Online Market

Веб-таблица для анализа выгрузок рынка EVE Online: парсинг `.xlsx/.xls` в браузере, метрики (маржа, спред, оборот, оценка входа), фильтры, сортировка и UI в стиле EVE. Данные с диска не уходят на внешний сервер, кроме явных действий (ссылки на выгрузки, EVE Tycoon, ESI в dev).

## Возможности

- **Локальный Excel** — перетаскивание или выбор файла; разбор полностью в браузере.
- **Кеш выгрузок** — импорт и результат ESI пишутся в IndexedDB браузера (и в dev, и в проде). Список позволяет снова открыть файл и сравнить два региона после перезагрузки. Файл с тем же именем заменяет предыдущий.
- **Market Logs (`.txt`)** — импорт последнего или выбранного EVE market log из указанной папки; есть live-режим (SSE) для автоподхвата новых логов в dev.
- **Пресеты фильтров** — отдельные заготовки и кнопка **«Применить все»** (совокупно те же условия, что и базовый набор фильтров).
- **ESI** — выгрузка с официального ESI в браузере, прогресс в UI, опция принудительного стопа. Готовый `.xlsx` скачивается и сохраняется в кеш браузера.
- **Сохранение фильтров** в `localStorage`; в dev — дополнительно `filters.json` в проекте (см. [`src/lib/filterPersistence.ts`](src/lib/filterPersistence.ts)).
- **Вкладка «Персонаж»** — EVE SSO (PKCE), ESI: кошелёк, журнал, рыночные транзакции, активы; дашборд с net worth (оценка), графиками и таблицей сделок. Скопируйте [`.env.example`](.env.example) в `.env` и укажите `VITE_EVE_SSO_CLIENT_ID` из [приложения CCP](https://developers.eveonline.com/); Redirect URI должен совпадать с URL приложения (например `http://localhost:5173/`).

## Требования

- [Node.js](https://nodejs.org/) 18+ (для `npm` и локального dev)

## Быстрый старт

```bash
npm install
npm run dev
```

Откройте в браузере адрес, который выведет Vite (обычно `http://localhost:5173`).

## Запуск в Docker

1. Скопируйте переменные окружения:

```bash
cp .env.example .env
```

Для PowerShell:

```powershell
Copy-Item .env.example .env
```

2. Запуск в dev-режиме (dev API для market logs и `filters.json`):

```bash
docker compose up --build app-dev
```

Приложение будет доступно на `http://localhost`.

- Каталог `./exports` на хосте пробрасывается в контейнер (`/app/exports`): там лежит `filters.json` dev-режима. Книги Excel в эту папку не пишутся — они остаются в кеше браузера.
- Для остановки: `docker compose down`.

3. (Опционально) запуск preview production-сборки:

```bash
docker compose --profile preview up --build app-preview
```

Preview будет доступен на `http://localhost`.

## Скрипты

| Команда | Назначение |
|---|---|
| `npm run dev` | Режим разработки (Vite + dev API `__dev/*`) |
| `npm run build` | TypeScript-check + production-сборка в `dist/` |
| `npm run preview` | Локальный просмотр production-сборки |
| `npm test` | Тесты (Vitest) |
| `npm run prefetch:esi-universe` | Предзагрузка `public/esi-universe-static.json` (types/groups/categories) |
| `npm run sonar:scan` | Запуск SonarScanner |
| `npm run sonar:export` | Экспорт issues Sonar в `reports/sonar/` |
| `npm run sonar` | Полный sonar-цикл: scan + export |

## Dev API (только `npm run dev`)

Сервер Vite отдаёт маршруты `/__dev/export/marketlogs/*` и `/__dev/filters/*`: импорт market logs и чтение/сохранение `filters.json`.
Книги Excel через этот сервер не отдаются: список выгрузок живёт в IndexedDB браузера и в dev, и в проде.
Статическая выкладка `dist` без dev-мидлвара не читает `filters.json` и не следит за папкой market logs.

- `filters.json` для фильтров таблицы — только в dev, через тот же dev-слой.
- Для market logs используются dev-маршруты:
  - `GET /__dev/export/marketlogs/stream?dirPath=...` (SSE-события по новым `.txt`),
  - `POST /__dev/export/marketlogs/latest`,
  - `POST /__dev/export/marketlogs/file`.

## Выгрузка через ESI

Кнопка **«Сформировать (ESI)»** для выбранного региона собирает книгу в браузере: запросы идут на `https://esi.evetech.net/latest` (ордера, история по типам), а названия и иерархия universe (`types/groups/categories`) берутся из локального `public/esi-universe-static.json`. Таблица собирается в формате, совместимом с парсером ([`src/lib/dev/esiLiquidityExport.ts`](src/lib/dev/esiLiquidityExport.ts)), скачивается как `.xlsx`, открывается в приложении и сохраняется в кеш браузера. Ожидайте **1–3+ минуты**; при 420/503 — паузы (лимиты CCP). Кнопка **«Стоп → xlsx»** прерывает длинный прогон и формирует файл по накопленным данным.

Режим выгрузки — всегда полный: чтение страниц ордеров идёт до исчерпания ESI, без ручных лимитов по страницам и типам.
Окно рыночной истории выбирается в UI: **30 / 7 / 2 дня**.

Перед первым запуском рекомендуется обновить статический каталог:

```bash
npm run prefetch:esi-universe
```

Для `Active Market Orders` дополнительно используется локальный справочник
`public/esi-trade-hubs-static.json` (5 регионов и 5 хаб-станций), чтобы не делать
runtime-запросы к `/universe/stations/{id}/` и `/universe/regions/{id}/` для этих ID.

В production этот блок **не** показан; для публичного хоста нужен отдельный бэкенд с тем же пайплайном.

**CORS / origin:** для dev путей `__dev` настроены заголовки; страница и API должны совпадать по origin (не смешивайте `localhost` и `127.0.0.1` в одной сессии).

## GitHub Pages (CI/CD)

В репозитории есть workflow [`deploy-github-pages.yml`](.github/workflows/deploy-github-pages.yml), который:

- собирает проект на push в `main/master` или вручную через `workflow_dispatch`,
- публикует содержимое `dist/` в GitHub Pages,
- автоматически задаёт `VITE_BASE_PATH` как `/{repo}/` для Project Pages (или берёт `vars.VITE_BASE_PATH`, если задана переменная репозитория).

Для EVE SSO в CI используйте секреты:

- `VITE_EVE_SSO_CLIENT_ID` (обязательно для вкладки «Персонаж»),
- `VITE_EVE_SSO_REDIRECT_URI` (опционально, если нужен фиксированный callback URI).

## Стек

React, TypeScript, Vite, TanStack Table, SheetJS (xlsx), Tailwind — см. `package.json`.

## Лицензия и EVE

EVE Online и связанные материалы — торговая марка CCP. Проект не аффилирован с CCP; ESI подчиняется [правилам CCP](https://developers.eveonline.com/).
