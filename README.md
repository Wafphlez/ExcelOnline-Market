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

## Стек

React, TypeScript, Vite, TanStack Table, xlsx, Tailwind (см. `package.json`).
