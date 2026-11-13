# SMART PRICE — Архитектура (GovTech Hackathon 2026 · Кейс №3)

## Стек
Next.js 14 App Router, React 18, TypeScript, Recharts, Lucide, Sonner, Leaflet, SQLite (`node:sqlite` на Node 24 / `better-sqlite3` на Node 20), Tesseract.js (`kaz+rus+eng`) и серверный AI Gateway (`alem.ai · qwen3-8` / OpenAI-compatible / Gemini).

## Модули
- `components/smartprice/SmartPrice.tsx`: интерфейс на 3 языках (`kk`, `ru`, `en`), роли, дашборд, карта, мониторинг, верификация, история, отчёты, настройки AI.
- `components/smartprice/AiAnalyticsPanel.tsx`: региональное и периодное сравнение **Min / Медиана / Max**, радар шринкфляции (`900 г / 450 ₸ = 500 ₸/кг`), AI Executive Brief и grounded AI Copilot.
- `components/smartprice/PriceTagScanner.tsx`: загрузка фото ценника/чека (или генерация тестового PNG) → Tesseract OCR → LLM-нормализация и сопоставление SKU с подтверждением специалиста.
- `components/smartprice/SmartImportModal.tsx`: предпросмотр CSV/XLSX и AI-парсинг неструктурированных строк с проверкой ошибок и дубликатов до записи в БД.
- `lib/smartprice/engine.cjs`: SQLite WAL-хранилище, бизнес-правила, MAD Z-Score, транзакционный аудит, сессии и предвалидация импорта.
- `lib/smartprice/ml.ts` / `metrics-core.mjs`: корзина, 7-дневный прогноз Holt Double Exponential Smoothing, Min/Median/Max по регионам/периодам и детектор шринкфляции.
- `lib/smartprice/ai.cjs`: серверный AI-шлюз (`alem.ai` `qwen3-8`, Gemini, OpenAI-compatible) с честным статистическим fallback.
- `app/api/smartprice/[...path]/route.ts`: аутентифицированные HTTP-маршруты, 2-листовой XLSX-экспорт (Наблюдения + Min/Median/Max), OCR, AI-объяснения, Copilot.

## Принцип Human-in-the-Loop и соответствие Кейсу №3
1. AI и статистические правила (`±15%`, `+30% к медиане`, `MAD Z-Score ≥ 3.5`) формируют **сигналы для проверки**, а не юридическое заключение о нарушении.
2. Все числа передаются в LLM строго из SQLite/ML-слоя, чтобы исключить галлюцинации.
3. Все секреты AI API хранятся на сервере (`.env.local` или серверная таблица `settings`) и никогда не возвращаются в браузер.
