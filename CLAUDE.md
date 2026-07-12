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

> For critical code paths, state variables, integration details, and gotchas per accelerator, see **`components/CLAUDE.md`** and **`server/routes/CLAUDE.md`**.

| Component | Purpose | Inputs |
|---|---|---|
| `Rationalizer.tsx` | Groups similar PDFs by hash or semantic embedding | Multiple PDFs |
| `PdfCompare.tsx` | Side-by-side AI-powered semantic diff of two PDFs | Two PDFs |
| `PdfVisualCompare.tsx` | Visual word-level page diff with smart page matching, no AI | Two PDFs |
| `DataMappingGenerator.tsx` | Maps Word doc fields to XSD schema, generates XML | DOCX + XSD |
| `XPathExtractor.tsx` | Extracts PDF data and maps to XML XPath locations | PDF + XML |
| `FieldExtractor.tsx` | Generates synthetic data from an XSD schema; bundle mode with test cases CSV | XSD (+ optional CSV) |
| `LayoutRecommendation.tsx` | Reformats a customer communication document into optimised Email and WhatsApp versions | PDF or DOCX |
| `AccessibilityScorer.tsx` | Scores a PDF against WCAG 2.1 Level A/AA criteria | PDF |
| `GhostDraftGenerator.tsx` | Converts a `.gd` template into a variable-mapped GhostDraft XML with fill point instructions | `.gd` (+ optional CSV, XSD, ref `.gd`) |
| `TestCaseGenerator.tsx` | Generates categorised test cases from a business rules CSV; output feeds FieldExtractor bundle mode | CSV of rules |

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

All LLM calls are routed through `services/llmService.ts` → `/v1/llm/gemini` or `/v1/llm/claude` proxy (server fetches per-user API key from Postgres; env vars are fallback). **Exception**: `GhostDraftGenerator` posts directly to `/v1/ghostdraft-generator`; all provider routing is handled server-side there.

| Service | Models used |
|---|---|
| `geminiService.ts` | `gemini-2.5-flash` for all tasks. Structured schema (`responseMimeType:'application/json'` + `responseSchema`) except `scoreAccessibility` which uses `cleanJson()` post-processing |
| `claudeService.ts` | `claude-haiku-4-5-20251001` (simpler) / `claude-sonnet-4-6` (XPath extraction, data mapping) |

`embedContentBatch` in `geminiService` is a **client-side word-hash function** (768-dim vectors) — it does NOT call the Gemini API. Real embeddings are only available via `POST /v1/rationalizer/embed`.

### Server (Express, port 3001)

`server/app.ts` registers all routes; `server/index.ts` starts the server. All `/v1/*` requests from the Vite dev server are proxied here.

| Route prefix | File | Auth required |
|---|---|---|
| `/v1/auth` | `routes/auth.ts` | — |
| `/v1/users` | `routes/users.ts` | Admin only |
| `/v1/llm` | `routes/llm.ts` | — (API key enforced) |
| `/v1/rationalizer` | `routes/rationalizer.ts` | — |
| `/v1/pdf-compare` | `routes/pdfCompare.ts` | — |
| `/v1/pdf-exact-compare` | `routes/pdfExactCompare.ts` | **Yes** |
| `/v1/api` | `routes/exactCompareApi.ts` | — |
| `/v1/data-mapping` | `routes/dataMapping.ts` | — |
| `/v1/xpath-extractor` | `routes/xpathExtractor.ts` | — |
| `/v1/synthetic-data` | `routes/syntheticData.ts` | — |
| `/v1/layout-recommendation` | `routes/layoutRecommendation.ts` | — |
| `/v1/ghostdraft-generator` | `routes/ghostDraftGenerator.ts` | **Yes** |
| `/v1/health` | inline | — |

Auth middleware: `server/middleware/auth.ts` (JWT verification, sets `req.user`). DB pool: `server/db.ts` (Neon Postgres). Detailed route internals: see **`server/routes/CLAUDE.md`**.

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
