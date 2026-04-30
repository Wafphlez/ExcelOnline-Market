# Excel Online Market

Веб-таблица для анализа выгрузок рынка EVE Online: парсинг `.xlsx/.xls` в браузере, метрики (маржа, спред, оборот, оценка входа), фильтры, сортировка и UI в стиле EVE. Данные с диска не уходят на внешний сервер, кроме явных действий (ссылки на выгрузки, EVE Tycoon, ESI в dev).

## Возможности

- **Локальный Excel** — перетаскивание или выбор файла; разбор полностью в браузере.
- **Папка `exports/` (только `npm run dev`)** — список `.xlsx/.xls` из каталога `exports/` проекта, открытие выбранного файла в таблицу; обновление списка, запоминание выбора.
- **Пресеты фильтров** — отдельные заготовки и кнопка **«Применить все»** (совокупно те же условия, что и базовый набор фильтров).
- **ESI (dev)** — длительная выгрузка в `exports/` с официального ESI, прогресс в UI, опция принудительного стопа.
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

2. Запуск в dev-режиме (с dev API для `exports/`):

```bash
docker compose up --build app-dev
```

Приложение будет доступно на `http://localhost`.

- Каталог `./exports` на хосте пробрасывается в контейнер (`/app/exports`), поэтому Excel-файлы и `filters.json` сохраняются между перезапусками.
- Для остановки: `docker compose down`.

3. (Опционально) запуск preview production-сборки:

```bash
docker compose --profile preview up --build app-preview
```

Preview будет доступен на `http://localhost`.

## Скрипты

| Команда         | Назначение                    |
|-----------------|-------------------------------|
| `npm run dev`   | Режим разработки, hot reload  |
| `npm run build` | Сборка в `dist/`              |
| `npm run preview` | Просмотр production-сборки  |
| `npm test`      | Тесты (Vitest)                |
| `npm run prefetch:esi-universe` | Предзагрузка `public/esi-universe-static.json` (types/groups/categories) |

## Папка `exports/` и dev API (только `npm run dev`)

Сервер Vite отдаёт маршруты `/__dev/export/*`: список файлов, отдача файла по имени, ESI-экспорт. Статическая выкладка `dist` без dev-мидлвара **не** пишет и **не** читает `exports/`.

- Блок **«Открыть локальный файл»** работает с реальным содержимым `exports/`, не с выбором «регион → имя файла».
- `filters.json` для фильтров таблицы — только в dev, через тот же dev-слой.

## Выгрузка через ESI (dev)

Кнопка **«Сформировать (ESI)»** для выбранного региона вызывает `POST /__dev/export/esi-liquidity`: Vite тянет данные с `https://esi.evetech.net/latest` (ордера, история по типам), а названия и иерархию universe (`types/groups/categories`) берёт из локального `public/esi-universe-static.json`. Таблица собирается в формате, совместимом с парсером ([`src/lib/dev/esiLiquidityExport.ts`](src/lib/dev/esiLiquidityExport.ts)), пишет `exports/liquidity-esi-{regionId}.xlsx` и открывает файл в приложении. Ожидайте **1–3+ минуты**; при 420/503 — паузы (лимиты CCP). Кнопка **«Стоп → xlsx»** прерывает длинный прогон и формирует файл по накопленным данным.

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

## Стек

React, TypeScript, Vite, TanStack Table, SheetJS (xlsx), Tailwind — см. `package.json`.

## Лицензия и EVE

EVE Online и связанные материалы — торговая марка CCP. Проект не аффилирован с CCP; ESI подчиняется [правилам CCP](https://developers.eveonline.com/).
