# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start Vite (port 3000) + Express API server (port 3001) concurrently
npm run dev:ui       # Vite dev server only
npm run dev:api      # Express API server only (tsx watch)
npm run build        # Production build
npm run lint         # TypeScript type check (tsc --noEmit)
npm run preview      # Preview production build
```

**Required**: Create `.env.local` with `GEMINI_API_KEY=<your-key>` and/or `ANTHROPIC_API_KEY=<your-key>` before running. API keys can also be stored per-user in the database and will take precedence.

## Architecture

**Entry point**: `index.html` → `index.tsx` → `App.tsx`

`App.tsx` is the shell with sidebar navigation routing to eight self-contained accelerator tools plus Home, API Docs, and Settings pages. Auth is required — unauthenticated users see `Login.tsx`. Each tool manages its own state; there is no global state manager beyond the two React contexts.

### React Contexts

| Context | File | Purpose |
|---|---|---|
| `AuthContext` | `contexts/AuthContext.tsx` | JWT auth state, login/logout, per-user preferences (`UserRole`: Admin \| AppUser) |
| `SettingsContext` | `contexts/SettingsContext.tsx` | App settings (theme, llmProvider, API keys) synced to `dih_settings` localStorage |

On login, `App.tsx` hydrates `SettingsContext` (and localStorage) from the user's DB preferences so LLM services always pick up the correct keys.

### Tools (in `/components`)

| Component | Purpose | Inputs |
|---|---|---|
| `Rationalizer.tsx` | Groups similar PDFs by hash or semantic embedding | Multiple PDFs |
| `PdfCompare.tsx` | Side-by-side AI-powered semantic diff of two PDFs | Two PDFs |
| `PdfVisualCompare.tsx` | Visual word-level page diff with smart page matching, no AI | Two PDFs |
| `DataMappingGenerator.tsx` | Maps Word doc fields to XSD schema, generates XML | DOCX + XSD |
| `XPathExtractor.tsx` | Extracts PDF data and maps to XML XPath locations | PDF + XML |
| `FieldExtractor.tsx` | Generates synthetic data from an XSD schema | XSD |
| `LayoutRecommendation.tsx` | Reformats a customer communication document into optimised Email and WhatsApp versions | PDF or DOCX |
| `AccessibilityScorer.tsx` | Scores a PDF against WCAG 2.1 Level A/AA criteria | PDF |

### Pages (also in `/components`)

| Component | Purpose |
|---|---|
| `Home.tsx` | Landing page with tool cards and navigation shortcuts |
| `ApiDocs.tsx` | REST API reference documentation |
| `SettingsPage.tsx` | User preferences: theme, LLM provider, API keys |
| `Login.tsx` | Authentication gate — shown when no valid JWT is present |

### Shared UI Components

| Component | Purpose |
|---|---|
| `FileUploader.tsx` | Drag-and-drop with file type validation (used by most tools) |
| `PdfUploader.tsx` | PDF-specific uploader variant |
| `ResultsTable.tsx` | Renders tabular AI output |
| `Loader.tsx` | Spinner/loading indicator |
| `ToggleSwitch.tsx` | Reusable toggle control |
| `SettingsPanel.tsx` | Settings form widget (used inside SettingsPage) |
| `LLMWarning.tsx` | Banner shown for accelerator tools when no API key is configured; links to Settings |
| `UserMenu.tsx` | Top-right user dropdown (Settings + Logout) |

### AI Service Layer

All LLM calls are routed through `services/llmService.ts`, which reads the user's provider preference (`llmProvider` in `dih_settings` localStorage key) and delegates to the appropriate backend:

- `services/geminiService.ts` — Gemini provider. Two model tiers:
  - `gemini-2.5-flash` — simpler tasks (field extraction, semantic comparison, layout, accessibility)
  - `gemini-2.5-pro` — complex tasks (XPath mapping, data mapping generation)
- `services/claudeService.ts` — Claude (Anthropic) provider. Model tiers:
  - `claude-haiku-4-5-20251001` — simpler tasks
  - `claude-sonnet-4-6` — complex tasks (XPath extraction, data mapping)

Both services call a server-side proxy (`server/routes/llm.ts`) at `/v1/llm/gemini` and `/v1/llm/claude` respectively. The proxy fetches the user's API key from the database (with `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` env var fallback) and forwards the request to the upstream LLM API.

Structured responses use JSON Schema validation (Gemini only). Client-side cosine similarity on embeddings is used as a fallback when the API is unavailable (Rationalizer).

### Server (Express, port 3001)

`server/app.ts` registers all routes; `server/index.ts` starts the server. All `/v1/*` requests from the Vite dev server are proxied here.

| Route prefix | File | Purpose |
|---|---|---|
| `/v1/auth` | `routes/auth.ts` | Login, JWT issuance |
| `/v1/users` | `routes/users.ts` | User management (Admin only) |
| `/v1/llm` | `routes/llm.ts` | LLM proxy (Gemini + Claude) |
| `/v1/rationalizer` | `routes/rationalizer.ts` | PDF rationalization |
| `/v1/pdf-compare` | `routes/pdfCompare.ts` | AI PDF compare |
| `/v1/pdf-exact-compare` | `routes/pdfExactCompare.ts` | Exact/visual PDF compare |
| `/v1/api` | `routes/exactCompareApi.ts` | REST API for exact compare |
| `/v1/data-mapping` | `routes/dataMapping.ts` | Data mapping generation |
| `/v1/xpath-extractor` | `routes/xpathExtractor.ts` | XPath extraction |
| `/v1/synthetic-data` | `routes/syntheticData.ts` | Synthetic data generation |
| `/v1/layout-recommendation` | `routes/layoutRecommendation.ts` | Layout recommendation |
| `/v1/health` | inline | Health check |

Auth middleware lives at `server/middleware/auth.ts` (JWT verification). `server/db.ts` holds the Neon Postgres connection pool.

### Document Processing

- **PDF**: `pdfjs-dist` for text extraction and page rendering; PDF data sent to Gemini as base64
- **DOCX**: `mammoth` for text extraction
- **XSD/XML**: Passed as raw text in prompts
- **Clustering** (Rationalizer): Agglomerative hierarchical clustering on embedding vectors

## Development Rules

**Accelerator isolation**: Fixing or modifying one accelerator must not break another. Each accelerator is self-contained — verify that any change scoped to one tool does not have unintended side effects on others.

**Shared code changes**: If a fix requires modifying shared code (`services/geminiService.ts`, `services/claudeService.ts`, `services/llmService.ts`, `ResultsTable.tsx`, `FileUploader.tsx`, `types.ts`, server middleware, or any other file used by more than one accelerator), do **not** edit the shared code directly. Instead, create an accelerator-specific copy of the relevant function, component, or module and apply the change only there. Reference the original shared code from all other accelerators unchanged.

## Key Config

- `vite.config.ts`: Dev server on `0.0.0.0:3000`; proxies `/v1/*` to `http://localhost:3001` (Express); proxies `/api/gemini` to the Gemini API; passes `GEMINI_API_KEY` from env to client via `define`
- `tsconfig.json`: ES2022 target, `@/*` path alias resolves to project root
- `metadata.json`: Google AI Studio metadata (app name/description, no frame permissions required)
- Tailwind CSS is loaded via CDN in `index.html` — no PostCSS pipeline
- Default admin credentials: `admin` / `Admin@123`; roles are `Admin` and `AppUser`
