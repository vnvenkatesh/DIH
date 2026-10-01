# CLAUDE.md — Document Intelligence Hub

Complete reconstruction guide. Everything here is enough to rebuild this solution from scratch.

---

## Table of Contents

1. [What This Solution Does](#1-what-this-solution-does)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Setup & Running Locally](#4-setup--running-locally)
5. [Environment Variables](#5-environment-variables)
6. [Database Schema](#6-database-schema)
7. [Authentication System](#7-authentication-system)
8. [Frontend Architecture](#8-frontend-architecture)
9. [React Contexts](#9-react-contexts)
10. [Accelerator Tools (Components)](#10-accelerator-tools-components)
11. [Pages & Shared UI](#11-pages--shared-ui)
12. [AI Service Layer](#12-ai-service-layer)
13. [Server Architecture](#13-server-architecture)
14. [Server Routes (API)](#14-server-routes-api)
15. [TypeScript Types](#15-typescript-types)
16. [Config Files](#16-config-files)
17. [Vercel Deployment](#17-vercel-deployment)
18. [AI Provider Model Defaults & Pricing](#18-ai-provider-model-defaults--pricing)
19. [Development Rules](#19-development-rules)
20. [Commands Reference](#20-commands-reference)

---

## 1. What This Solution Does

**Document Intelligence Hub** is a multi-tool AI-powered document processing platform built for Deloitte. It provides ten specialised accelerator tools that process PDFs, Word documents, XSD schemas, and XML files using LLM backends (Google Gemini, Anthropic Claude, OpenAI).

| Tool | What It Does | Inputs |
|---|---|---|
| **Rationalizer** | Groups similar PDFs by content similarity using hash or semantic embeddings; surfaces repeated/unique clauses across a document corpus | Multiple PDFs |
| **PDF Compare (Semantic)** | Side-by-side AI-powered semantic diff of two PDFs — finds meaning-level differences, not just text changes | Two PDFs |
| **PDF Visual Compare** | Word-level visual diff with DP page matching; handles page insertions/deletions — no LLM required | Two PDFs |
| **Data Mapping Generator** | Extracts variable fields from DOCX templates, maps them to XSD XPaths, generates populated XML | DOCX files + XSD |
| **XPath Extractor** | Reads visible values from a PDF and maps each to its full absolute XPath in a companion XML file | PDF + XML |
| **Field Extractor / Synthetic Data** | Generates realistic synthetic XML records from an XSD schema; in bundle mode produces per-category test XMLs from a test-cases CSV | XSD (+ optional CSV) |
| **Layout Recommendation** | Reformats a customer communication document into optimised Email and WhatsApp channel versions | PDF or DOCX |
| **Accessibility Scorer** | Audits a PDF against WCAG 2.1 Level A/AA criteria and scores it A–F with per-criterion detail | PDF |
| **GhostDraft Generator** | Converts a proprietary `.gd` GhostDraft template into a variable-mapped `.gd` XML with fill-point instructions | `.gd` (+ optional CSV, XSD, reference `.gd`) |
| **Test Case Generator** | Generates categorised test cases (Happy Path, Mandatory, Boundary, Conditional, Format, Calculation) from a business rules CSV | CSV of rules |

Additional pages: **Home** (landing), **API Docs** (inline REST reference), **Settings** (theme, LLM provider, API keys, usage stats), **Help**, **Flow** (chained multi-accelerator pipeline).

The platform enforces JWT authentication, stores API keys per-user in Neon Postgres (never exposed client-side after storage), and provides role-based access (Admin / AppUser).

---

## 2. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend framework | React | ^19.2.0 |
| Build tool | Vite | ^6.2.0 |
| Language | TypeScript | ~5.8.2 |
| CSS | Tailwind CSS (CDN, no PostCSS) | Latest CDN |
| Backend | Express | ^4.21.2 |
| Backend runner (dev) | tsx (watch mode) | — |
| Database | Neon Postgres (serverless) | pg ^8.21.0 |
| Auth | JWT (jsonwebtoken ^9.0.3) + bcryptjs ^3.0.3 | — |
| PDF (client) | pdfjs-dist | 5.4.624 (pinned) |
| PDF (server) | pdf-parse ^1.1.1 | — |
| DOCX extraction | mammoth ^1.11.0 | — |
| File upload | multer ^1.4.5-lts.1 (memory storage) | — |
| Text diff | diff ^8.0.2 | — |
| Image processing | sharp ^0.35.3 | — |
| PDF manipulation | pdf-lib ^1.17.1 | — |
| AI SDKs | @google/genai ^1.29.1 (server) | — |
| Deployment | Vercel (Fluid Compute, Node.js) | — |

---

## 3. Project Structure

```
document-intelligence-hub/
├── index.html                        # Entry; loads Tailwind CDN + importmap for ESM
├── index.tsx                         # React root — ReactDOM.createRoot('#root')
├── index.css                         # Minimal global styles
├── App.tsx                           # Main shell: sidebar nav, auth gate, tool routing
├── types.ts                          # ALL shared TypeScript interfaces/types
├── vite.config.ts                    # Vite + proxy config
├── tsconfig.json                     # TS compiler options
├── vercel.json                       # Vercel rewrite rules + function maxDuration
├── metadata.json                     # Google AI Studio metadata
├── package.json
├── .env.local                        # NOT committed — see §5
│
├── api/
│   └── index.ts                      # Vercel serverless function entry (wraps Express app)
│
├── components/                       # All React components
│   ├── CLAUDE.md                     # Per-accelerator critical-path docs & gotchas
│   ├── AccessibilityScorer.tsx
│   ├── AiInUseIndicator.tsx          # Top-right LLM switcher dropdown
│   ├── ApiDocs.tsx
│   ├── BusinessRulesExtractor.tsx
│   ├── DataMappingGenerator.tsx
│   ├── FieldExtractor.tsx            # Exported as SyntheticDataGenerator
│   ├── FileUploader.tsx              # Shared drag-and-drop uploader
│   ├── Flow.tsx                      # Multi-accelerator pipeline orchestrator
│   ├── GhostDraftGenerator.tsx
│   ├── HelpPage.tsx
│   ├── Home.tsx
│   ├── LayoutRecommendation.tsx
│   ├── LLMWarning.tsx
│   ├── Loader.tsx
│   ├── Login.tsx
│   ├── PdfCompare.tsx
│   ├── PdfUploader.tsx               # PDF-specific uploader variant
│   ├── PdfValidator.tsx
│   ├── PdfVisualCompare.tsx
│   ├── Rationalizer.tsx
│   ├── ResultsTable.tsx
│   ├── SettingsPage.tsx
│   ├── SettingsPanel.tsx
│   ├── TestCaseGenerator.tsx
│   ├── ToggleSwitch.tsx
│   ├── UserMenu.tsx
│   └── icons/                        # Inline SVG icon components
│       ├── AccessibilityIcon.tsx
│       ├── ArrowsRightLeftIcon.tsx
│       ├── ClipboardRulesIcon.tsx
│       ├── CodeBracketIcon.tsx
│       ├── DevicePhoneMobileIcon.tsx
│       ├── DocumentArrowUpIcon.tsx
│       ├── DocumentTextIcon.tsx
│       ├── HomeIcon.tsx
│       ├── LinkIcon.tsx
│       ├── PdfFileIcon.tsx
│       ├── ServerIcon.tsx
│       ├── Squares2X2Icon.tsx
│       ├── TestCaseIcon.tsx
│       ├── WordFileIcon.tsx
│       └── XmlFileIcon.tsx
│
├── contexts/
│   ├── AuthContext.tsx               # JWT auth state, login/logout, UserRole
│   └── SettingsContext.tsx           # Theme, llmProvider, API keys → dih_settings localStorage
│
├── services/
│   ├── llmService.ts                 # Provider router (reads dih_settings localStorage)
│   ├── geminiService.ts              # Gemini-specific calls + client-side embeddings
│   ├── claudeService.ts              # Claude-specific calls
│   ├── openaiService.ts              # OpenAI-specific calls
│   ├── mockedXmlsService.ts          # Bundle XML generation (FieldExtractor only)
│   └── rationalizerEmbedService.ts   # Real Gemini embeddings with keyword-hash fallback
│
└── server/
    ├── app.ts                        # Express app + all route registration
    ├── index.ts                      # Startup: dotenv → initDb → listen
    ├── db.ts                         # Neon Postgres pool + initDb() (tables + seed)
    ├── gemini.ts                     # Server-side Gemini client + prompt constants
    ├── lib/
    │   ├── pdf.ts                    # pdf-parse + mammoth extraction helpers
    │   └── pdfFont.ts                # Font-aware PDF extraction for precise diff
    ├── middleware/
    │   ├── auth.ts                   # requireAuth + requireAdmin (JWT)
    │   └── basicAuth.ts              # requireBasicAuth (HTTP Basic Auth, for /v1/api)
    ├── routes/
    │   ├── CLAUDE.md                 # Per-route internals, business logic, gotchas
    │   ├── auth.ts                   # /v1/auth
    │   ├── users.ts                  # /v1/users (Admin CRUD)
    │   ├── llm.ts                    # /v1/llm (Gemini/Claude/OpenAI proxy + stats)
    │   ├── rationalizer.ts           # /v1/rationalizer + /v1/rationalizer/embed
    │   ├── pdfCompare.ts             # /v1/pdf-compare
    │   ├── pdfExactCompare.ts        # /v1/pdf-exact-compare (JWT auth)
    │   ├── exactCompareApi.ts        # /v1/api (Basic Auth, external API)
    │   ├── dataMapping.ts            # /v1/data-mapping
    │   ├── xpathExtractor.ts         # /v1/xpath-extractor
    │   ├── syntheticData.ts          # /v1/synthetic-data
    │   ├── layoutRecommendation.ts   # /v1/layout-recommendation
    │   ├── ghostDraftGenerator.ts    # /v1/ghostdraft-generator (JWT auth)
    │   └── pdfValidator.ts           # /v1/pdf-validator
    └── utils/
        └── usageLogger.ts            # logUsage() → llm_usage_logs table
```

---

## 4. Setup & Running Locally

### Prerequisites
- Node.js 20+ (LTS)
- A Neon Postgres database (free tier works: https://neon.tech)
- At least one AI provider API key: Gemini, Anthropic, or OpenAI

### Steps

```bash
# 1. Clone and install
git clone <repo>
cd document-intelligence-hub
npm install

# 2. Create .env.local (see §5 for all variables)
cp .env.local.example .env.local   # or create manually

# 3. Start dev servers (Vite :3000 + Express :3001)
npm run dev

# 4. Open http://localhost:3000
# Login: admin / Admin@123
```

The database tables and the default admin account are created automatically on first server start via `initDb()` in `server/db.ts`. No migration tool needed.

---

## 5. Environment Variables

Create `.env.local` in the project root. **Never commit this file.**

```bash
# ── Required ──────────────────────────────────────────────
JWT_SECRET=your_long_random_secret_string_here

# Neon Postgres (get from Neon dashboard → Connection Details)
PGHOST=ep-xxxx-pooler.region.aws.neon.tech
PGUSER=neondb_owner
PGDATABASE=neondb
PGPASSWORD=your_neon_password

# ── AI Provider Keys (at least one required) ───────────────
GEMINI_API_KEY=AIzaSy...           # Google AI Studio key
# ANTHROPIC_API_KEY=sk-ant-...     # Anthropic key (server fallback)
# OPENAI_API_KEY=sk-...            # OpenAI key (server fallback)

# ── Optional ───────────────────────────────────────────────
API_PORT=3001                      # Express port (default: 3001)
```

**How keys are used:**
- `JWT_SECRET` — signs/verifies all JWT tokens (must be consistent across restarts)
- Postgres vars — `server/db.ts` uses `pg.Pool` with these 4 vars + `ssl: { rejectUnauthorized: false }`
- AI keys — per-user keys stored in Postgres take **precedence** over env vars; env vars are fallback only
- `GEMINI_API_KEY` is also injected into the Vite client bundle via `define` as `process.env.API_KEY` and `process.env.GEMINI_API_KEY`

**For Vercel deployment**, add all of the above to Vercel → Settings → Environment Variables. The `api/index.ts` cold-start validates `PGHOST`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`, `JWT_SECRET` and returns HTTP 500 with a descriptive message if any are missing.

---

## 6. Database Schema

Database: **Neon Postgres** (serverless). Pool: max 5 connections, SSL `rejectUnauthorized: false`. Managed in `server/db.ts → initDb()`.

### Table: `users`

```sql
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL CHECK (role IN ('Admin', 'AppUser')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  -- Preference columns (added with IF NOT EXISTS for idempotency):
  theme         VARCHAR(10)  DEFAULT 'light',
  llm_provider  VARCHAR(20)  DEFAULT 'gemini',
  gemini_api_key TEXT        DEFAULT '',
  claude_api_key TEXT        DEFAULT '',
  openai_api_key TEXT        DEFAULT '',
  gemini_model  VARCHAR(100) DEFAULT 'gemini-2.5-flash',
  claude_model  VARCHAR(100) DEFAULT 'claude-haiku-4-5-20251001',
  openai_model  VARCHAR(100) DEFAULT 'gpt-4o-mini'
);
```

### Table: `llm_usage_logs`

```sql
CREATE TABLE IF NOT EXISTS llm_usage_logs (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      VARCHAR(20)  NOT NULL,
  model         VARCHAR(100) NOT NULL,
  input_tokens  INTEGER      NOT NULL DEFAULT 0,
  output_tokens INTEGER      NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(12,8) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  accelerator   VARCHAR(100) NOT NULL DEFAULT 'Other'
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_logs_user_provider
  ON llm_usage_logs (user_id, provider);
```

### Seed Data

On first startup, if no Admin user exists, `initDb()` seeds:
- Username: `admin`, Password: `Admin@123` (bcrypt rounds=10), Role: `Admin`

---

## 7. Authentication System

### Mechanism
- **JWT** signed with `JWT_SECRET`, expiry **8 hours**
- Client stores `{ user, token }` as JSON in `localStorage` under key `dih_auth`
- Token expiry is checked client-side: `JSON.parse(atob(token.split('.')[1])).exp < Date.now()/1000`

### Middleware (`server/middleware/auth.ts`)

```typescript
requireAuth   // Verifies Bearer JWT → sets req.user = { id, username, role }
requireAdmin  // Calls requireAuth then checks role === 'Admin'; returns 403 otherwise
```

### Basic Auth (`server/middleware/basicAuth.ts`)

```typescript
requireBasicAuth  // Decodes Authorization: Basic <base64>, looks up DB, bcrypt compare
                  // Used ONLY by /v1/api (exactCompareApi) for external API consumers
```

### Routes requiring auth

| Route | Auth type |
|---|---|
| All `/v1/llm/*` | JWT (requireAuth) |
| `/v1/auth/me`, `/v1/auth/preferences` | JWT (requireAuth) |
| All `/v1/users/*` | JWT (requireAdmin) |
| `/v1/pdf-exact-compare` | JWT (requireAuth) |
| `/v1/ghostdraft-generator` | JWT (requireAuth) |
| `/v1/api` | HTTP Basic Auth |

### Roles

| Role | Permissions |
|---|---|
| `Admin` | Full user CRUD, all tools, own preferences |
| `AppUser` | All tools, own preferences only |

### Key flow on login
1. `POST /v1/auth/login` → validates credentials → returns JWT + full user object (including API keys)
2. `App.tsx` receives user → hydrates `SettingsContext` + writes `dih_settings` to localStorage
3. All subsequent LLM calls read API keys from localStorage via `llmService.ts` (outside React tree)
4. API keys are stored in DB and fetched server-side before each LLM proxy call — client receives them only as part of the user object on login

---

## 8. Frontend Architecture

### Entry Point
`index.html` → `index.tsx` → `App.tsx`

### `index.html` key features
- Loads **Tailwind CSS via CDN**: `https://cdn.tailwindcss.com` with `darkMode: 'class'` config
- Contains an **importmap** for browser-native ESM: React 19, react-dom, pdfjs-dist 5.4.624, diff, @google/genai
- Loads `index.tsx` as `type="module"`

### `App.tsx` — Main Shell
- Wraps everything in `<AuthContext>` and `<SettingsContext>` providers
- Unauthenticated: renders `<Login />`
- Authenticated: renders sidebar navigation + tool area
- **Single-SPA with hidden divs**: all tool components are mounted simultaneously; visibility controlled by `className={activeTool === 'X' ? '' : 'hidden'}` — avoids unmount/remount which would lose local state
  - **Exception**: `SettingsPage`, `HelpPage`, `ApiDocs` are conditionally rendered (not hidden) because state loss is acceptable there
- On login, hydrates `SettingsContext` from DB user preferences via `useSettings().updateSettings()`
- `AiInUseIndicator` renders in the top navigation bar — shows current LLM provider and warns if no key configured

---

## 9. React Contexts

### `AuthContext` (`contexts/AuthContext.tsx`)

```typescript
interface AuthContextValue {
  user: ClientUser | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

interface ClientUser {
  id: number;
  username: string;
  role: 'Admin' | 'AppUser';
  theme: string;
  llm_provider: string;
  gemini_api_key: string;
  claude_api_key: string;
  openai_api_key: string;
  gemini_model: string;
  claude_model: string;
  openai_model: string;
}
```

- Persists `{ user, token }` to `dih_auth` localStorage key
- `login()` calls `POST /v1/auth/login`, stores response, triggers settings hydration
- `logout()` clears localStorage and resets state

### `SettingsContext` (`contexts/SettingsContext.tsx`)

```typescript
interface AppSettings {
  theme: 'light' | 'dark';
  llmProvider: 'gemini' | 'claude' | 'openai';
  geminiApiKey: string;
  claudeApiKey: string;
  openaiApiKey: string;
  geminiModel: string;
  claudeModel: string;
  openaiModel: string;
}
```

- Synced to `dih_settings` localStorage key
- `llmService.ts` reads `dih_settings` directly from localStorage (not via React context) so it works outside the component tree
- Theme changes apply `dark` class to `<html>` element

---

## 10. Accelerator Tools (Components)

### Rationalizer (`components/Rationalizer.tsx`, ~51 KB)

**Purpose:** Groups multiple PDFs by content similarity; surfaces repeated and unique clauses.

**Props:** `onCompareRequest?: (files: [File, File]) => void`

**Key state:**
- `files: ProcessedDocument[]` — uploaded PDFs with extracted text + embeddings
- `groupingMode: 'exact' | 'semantic'`
- `similarityThreshold: number` (70–99)
- `results: DocumentGroup[]` — clustered groups
- `repeatedClauses: ClauseMatch[]` — clauses found in 2+ documents
- `uniqueClausesByGroup` — clauses unique to each group
- `groupSummaries` — LLM-generated group summaries

**Pipeline:**
1. `pdfjs-dist` extracts text from each PDF client-side
2. **Exact mode**: SHA-256 of normalized text → group identical hashes
3. **Semantic mode**: client-side word-hash embeddings (768-dim, NOT Gemini API) → cosine similarity matrix → greedy agglomerative clustering
4. Clause detection: Jaccard similarity on 3-sentence sliding windows (threshold 0.65)
5. Exports: CSV of clauses, HTML master document with TOC

**Note:** `embedContentBatch` in `geminiService.ts` is a pure client-side word-hash function returning normalized 768-dim vectors — it does NOT call the Gemini API. Real Gemini embeddings are available via `POST /v1/rationalizer/embed` and accessed through `rationalizerEmbedService.ts`.

---

### PDF Compare (`components/PdfCompare.tsx`, ~48 KB)

**Purpose:** Side-by-side AI semantic diff or client-side exact diff of two PDFs.

**Props:** `initialFiles?: [File, File]`, `onInitialFilesConsumed?: () => void`

**Modes:**
- **Semantic**: pdfjs text → `llmService.performSemanticComparison` → `/v1/llm/gemini|claude` → highlight bboxes via substring search
- **Exact**: `diffWordsWithSpace` (npm diff library) on extracted text
- **Precise**: pixel-block canvas comparison (10px grid; >5% pixel difference = purple highlight)

**Highlight colours:**
| Colour | Meaning |
|---|---|
| Green | Semantically same (minor wording difference) |
| Blue | Added |
| Red | Removed |
| Yellow | Modified |
| Orange | Font difference |
| Purple | Pixel-level difference |

**Sync scroll:** Proportional `handleScroll()` keeps both PDF panels in sync.

---

### PDF Visual Compare (`components/PdfVisualCompare.tsx`, ~68 KB — largest component)

**Purpose:** Word-level visual diff with DP page matching — handles page insertions/deletions. No LLM.

**Pipeline:**
1. `pdfjs-dist` word extraction → paragraph building
2. DP page matching using Jaccard similarity (MATCH_THRESHOLD=0.25)
3. LCS word diff → merge adjacent highlights
4. Precise mode: colour bucket analysis of pixel averages; strips font-name prefixes (`ABCDEF+`, `g_d0_`)
5. Navigation: ordered `navList` IDs with paired L/R DOM scroll

---

### Data Mapping Generator (`components/DataMappingGenerator.tsx`, ~27 KB)

**Purpose:** Extracts variable fields from DOCX templates, maps to XSD XPaths, generates XML.

**Inputs:** Multiple DOCX/text files + single XSD file

**Key state:**
- `fileProgress: FileProgress[]` — status per file: `'pending' | 'processing' | 'done' | 'error'`
- `consolidated: ConsolidatedDataMapping[]` — deduplicated cross-template field mappings
- `generatedXml: string`

**Pipeline:**
1. `mammoth.convertToHtml()` → `htmlToStructuredText()`
2. `llmService.generateDataMap(docxContent, xsdContent, templateName)`
3. `consolidateMappings()` — normalize field names + dedup; `"path not found"` is sentinel XSD path

**Exports:** CSV, XML.

---

### XPath Extractor (`components/XPathExtractor.tsx`, ~23 KB)

**Purpose:** Maps each visible PDF value to its full absolute XPath in a corresponding XML file.

**Pipeline:**
1. PDF → base64; XML → string
2. `llmService.extractXPaths(pdfBase64, mimeType, xmlContent, templateName)`
3. Gemini: PDF sent as multimodal `inlineData`; Claude: PDF as `document` block with `anthropic-beta: pdfs-2024-09-25` header

**Export:** CSV (Template Name, Page Number, Field Type, Value, XPath)

---

### Field Extractor / Synthetic Data (`components/FieldExtractor.tsx`, exported as `SyntheticDataGenerator`, ~23 KB)

**Purpose:** Generates synthetic XML from XSD; with test cases CSV produces per-category XML bundles.

**Inputs:** `xsdFile` (required), `testCasesCsvFile` (optional)

**Key state:**
- `xmlBundles: MockedXmlBundle[]` — one bundle per test case group
- `testCaseRows: string[][]` — parsed CSV rows

**Modes:**
- **Basic**: `llmService.generateSyntheticDataFromXsd(xsdContent)`; `parseFieldsFromXml()` fallback if fields array is empty
- **Bundle**: `parseCsv` → `validateTestCasesCsv` → `llmService.generateMockedXmlsFromTestCases`

**Category colours:** Happy Path=green, Mandatory=red, Boundary=yellow, Conditional=purple, Format=blue, Calculation=orange

---

### Layout Recommendation (`components/LayoutRecommendation.tsx`, ~12 KB)

**Purpose:** Reformats a customer communication PDF/DOCX into Email and WhatsApp channel versions.

**Pipeline:**
1. PDF → `pdfjs-dist` text; DOCX → `mammoth.extractRawText()`
2. `llmService.generateLayoutRecommendations(documentText)` → `{ emailVersion, whatsappVersion }`
3. Two `OutputCard` sub-components: email (blue border), WhatsApp (green border), each with `CopyButton`

---

### Accessibility Scorer (`components/AccessibilityScorer.tsx`, ~19 KB)

**Purpose:** WCAG 2.1 Level A/AA text-based audit of a PDF.

**Pipeline:**
1. `pdfjs-dist` text extraction → **hard truncation at 4000 chars**
2. `llmService.scoreAccessibility(documentText, fileName)` → `AccessibilityResult`
3. Gemini path: uses `cleanJson()` post-processing (no `responseSchema`)

**Display:** `ScoreGauge` SVG circle, grade A–F, accordion of criteria sorted fail→warning→pass→N/A

---

### GhostDraft Generator (`components/GhostDraftGenerator.tsx`, ~24 KB)

**Purpose:** Converts a `.gd` GhostDraft template into a variable-mapped `.gd` XML with fill-point instructions.

**Inputs:** `gdFile` (required), `csvFile` (optional), `xsdFile` (optional), `gdRefFile` (optional)

**Critical difference:** This is the **only accelerator that does NOT use `llmService`**. It posts `FormData` directly to `/v1/ghostdraft-generator` with JWT Bearer token. All LLM routing is handled server-side.

**Domain colours:** Claim=blue, Company=purple, Person=green

**Gotcha:** `handleNewDocument()` clears only `gdFile` + result; CSV/XSD/gdRef persist across documents.

---

### Test Case Generator (`components/TestCaseGenerator.tsx`, ~25 KB)

**Purpose:** Generates categorised test cases from a business rules CSV.

**Required CSV columns:** `Field Name`, `Rule Type`

**Two phases:**
1. File selection → immediate CSV parse (no LLM call)
2. "Generate" button → `llmService.generateTestCases(rulesAndHints)` → `TestCaseResult`

**Key state:** `rules: ParsedRule[]`, `parseError`, `hints: string`, `cases: IndexedTestCase[]` (TC-001 IDs), `activeFilter`

**Export:** 9-column CSV (Test Case ID, Field Section, Category, Description, Input Data, Expected Result, Priority, Preconditions, Test Steps) + JSON

---

### Business Rules Extractor (`components/BusinessRulesExtractor.tsx`, ~22 KB)

**Purpose:** Extracts structured business rules from a form specification document.

Uses `llmService.extractBusinessRules(docText)` → `BusinessRulesResult { rules: BusinessRule[] }`

---

### PDF Validator (`components/PdfValidator.tsx`, ~74 KB — largest component)

**Purpose:** Validates output documents against input data and test cases.

---

### Flow (`components/Flow.tsx`, ~51 KB)

**Purpose:** Chained multi-accelerator pipeline orchestrator — connects tools so output of one feeds input of another.

---

## 11. Pages & Shared UI

### Pages

| Component | Purpose |
|---|---|
| `Home.tsx` | Landing page with tool cards and navigation shortcuts |
| `ApiDocs.tsx` | REST API reference documentation (inline, no external fetch) |
| `SettingsPage.tsx` | Theme, LLM provider, per-provider API key + model selection, usage stats table |
| `HelpPage.tsx` | Help and support content |
| `Login.tsx` | Username/password form; calls `useAuth().login()`; always renders in light mode; "Designed by Deloitte" footer |

### Shared UI Components

| Component | Purpose |
|---|---|
| `AiInUseIndicator.tsx` | Top-right dropdown showing active LLM provider; click to switch; shows warning icon when no key configured |
| `UserMenu.tsx` | Top-right avatar dropdown: username + role badge, links to Settings / API Docs / Help / Sign Out |
| `LLMWarning.tsx` | Amber banner when no API key for current provider; "Go to Settings" link; returns `null` if key present |
| `FileUploader.tsx` | Drag-and-drop with file type validation (used by most tools) |
| `SettingsPanel.tsx` | Settings form widget (theme, provider, keys, models) used inside `SettingsPage` |
| `ResultsTable.tsx` | Renders tabular AI output |
| `Loader.tsx` | Spinner / loading indicator |
| `ToggleSwitch.tsx` | Reusable controlled toggle |

---

## 12. AI Service Layer

### Architecture

```
Component
  └── llmService.ts          (reads dih_settings localStorage → routes to provider)
        ├── geminiService.ts  (POST /v1/llm/gemini with Bearer token)
        ├── claudeService.ts  (POST /v1/llm/claude with Bearer token)
        └── openaiService.ts  (POST /v1/llm/openai with Bearer token)
```

### `services/llmService.ts`

Provider router. Reads `llmProvider` from `dih_settings` localStorage. All functions have identical signatures across providers.

| Function | Returns | Notes |
|---|---|---|
| `generateSyntheticDataFromXsd(xsdContent)` | `Promise<SyntheticDataResult>` | |
| `extractXPaths(pdfBase64, mimeType, xmlContent, templateName)` | `Promise<XPathMapping[]>` | |
| `generateDataMap(docxContent, xsdContent, templateName)` | `Promise<DataMappingResult>` | |
| `performSemanticComparison(textA, textB)` | `Promise<{textA,textB,reason,kind}[]>` | |
| `generateLayoutRecommendations(documentText)` | `Promise<LayoutRecommendationResult>` | |
| `scoreAccessibility(documentText, fileName)` | `Promise<AccessibilityResult>` | |
| `extractBusinessRules(docText)` | `Promise<BusinessRulesResult>` | |
| `generateTestCases(rulesAndHints)` | `Promise<TestCaseResult>` | |
| `embedContentBatch(texts)` | `Promise<number[][]>` | Gemini only; client-side word-hash (no API call) |

### `services/geminiService.ts`

- `callGemini(model, contents, generationConfig)` — POSTs to `/v1/llm/gemini` with `Authorization: Bearer <token>` from `dih_auth` localStorage
- `extractJsonText(result)` — filters out Gemini `thought` parts from thinking models
- `getGeminiModel()` — reads from `dih_settings` localStorage
- Module-level `let _accelerator = 'Other'` for usage logging tag
- Uses `responseMimeType: 'application/json'` + `responseSchema` for structured output on all functions **except** `scoreAccessibility` (uses `cleanJson()` post-processing)
- `embedContentBatch(texts)` — pure client-side word-hash function, 768-dim normalized vectors, no API call

### `services/claudeService.ts`

- `callClaude(payload, extraHeaders)` — POSTs to `/v1/llm/claude`; `body.beta` field serialized as `anthropic-beta` header server-side
- `getClaudeModel()` — reads from `dih_settings` localStorage
- **Tier usage**: Claude Sonnet for XPath extraction and data mapping; Haiku for all other tasks

### `services/openaiService.ts`

- `callOpenAI(model, messages, jsonMode)` — POSTs to `/v1/llm/openai`; `jsonMode=true` adds `response_format: { type: 'json_object' }`
- Helper: `cleanJson()` / `cleanJsonArray()` to strip markdown code fences

### `services/mockedXmlsService.ts`

Accelerator-specific service (isolated per the shared-code isolation rule). Provides `generateMockedXmlsFromTestCases(xsdContent, testCasesText)` → `Promise<MockedXmlsResult>`. Supports Gemini and Claude only (no OpenAI). Prompts LLM to produce 3–8 XML bundles covering all test case IDs.

### `services/rationalizerEmbedService.ts`

Drop-in replacement for `llmService.embedContentBatch`. Tries real Gemini `text-embedding-004` via `POST /v1/rationalizer/embed`; falls back to keyword-hash if no API key or API call fails. API key read from `dih_settings` localStorage.

---

## 13. Server Architecture

### `server/app.ts`

```typescript
const app = express();
app.use(cors());                           // All origins
app.use(express.json({ limit: '50mb' })); // Body size limit

// Route registration order matters — rationalizer/embed before multer
app.use('/v1/auth', authRouter);
app.use('/v1/users', usersRouter);
app.use('/v1/llm', llmRouter);
app.use('/v1/rationalizer', rationalizerRouter);  // includes /embed
app.use('/v1/pdf-compare', pdfCompareRouter);
app.use('/v1/pdf-exact-compare', pdfExactCompareRouter);
app.use('/v1/api', exactCompareApiRouter);
app.use('/v1/data-mapping', dataMappingRouter);
app.use('/v1/xpath-extractor', xpathExtractorRouter);
app.use('/v1/synthetic-data', syntheticDataRouter);
app.use('/v1/layout-recommendation', layoutRecommendationRouter);
app.use('/v1/ghostdraft-generator', ghostDraftRouter);
app.use('/v1/pdf-validator', pdfValidatorRouter);

// Health
app.get('/v1/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Global error handler
app.use((err, req, res, next) => {
  const status = err.status ?? err.statusCode ?? 500;
  res.status(status).json({ error: err.message });
});
```

### `server/index.ts`

```typescript
dotenv.config({ path: '.env.local' });
initDb()
  .then(() => app.listen(process.env.API_PORT ?? 3001))
  .catch(() => process.exit(1));
```

### `api/index.ts` — Vercel Serverless Entry

```typescript
// Checks 5 required env vars at cold-start
const REQUIRED_ENV = ['PGHOST','PGUSER','PGDATABASE','PGPASSWORD','JWT_SECRET'];
// Uses module-level `initialized` flag to skip re-running initDb on warm invocations
// Wraps Express app as a serverless handler
// maxDuration: 300 (set in vercel.json)
```

### `server/db.ts`

```typescript
const pool = new Pool({
  host: process.env.PGHOST,
  user: process.env.PGUSER,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  max: 5,
  ssl: { rejectUnauthorized: false }
});
```

`initDb()` runs all `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS` statements (idempotent), then seeds the default admin account if none exists.

### `server/utils/usageLogger.ts`

`logUsage({ userId, provider, model, inputTokens, outputTokens, costUsd, accelerator })` — inserts a row into `llm_usage_logs`. Called by all three LLM proxy routes after successful responses.

---

## 14. Server Routes (API)

### Auth Routes (`/v1/auth`)

**`POST /v1/auth/login`**
```
Body:     { username: string, password: string }
Response: { token: string, user: ClientUser }
Logic:    Case-insensitive username lookup → bcrypt.compare → JWT sign (8h)
Errors:   401 invalid credentials
```

**`GET /v1/auth/me`** _(requireAuth)_
```
Response: { user: ClientUser }
```

**`PUT /v1/auth/preferences`** _(requireAuth)_
```
Body:     { theme?, llm_provider?, gemini_api_key?, claude_api_key?, openai_api_key?,
            gemini_model?, claude_model?, openai_model? }
Response: { user: ClientUser }  (updated)
```

---

### User Management Routes (`/v1/users`) _(requireAdmin)_

**`GET /v1/users`** → `[{ id, username, role, created_at }]`

**`POST /v1/users`**
```
Body:     { username, password, role: 'Admin'|'AppUser' }
Response: { id, username, role, created_at }  (201)
Errors:   409 if username already exists
```

**`PUT /v1/users/:id`**
```
Body:     { username, role, password? }
```

**`DELETE /v1/users/:id`**
```
Guard:    Cannot delete own account
Response: 204 No Content
```

---

### LLM Proxy Routes (`/v1/llm`) _(requireAuth on all)_

**`POST /v1/llm/gemini`**
```
Body:     { model, contents, generationConfig, accelerator? }
Logic:    Fetches per-user gemini_api_key from DB (fallback: env GEMINI_API_KEY)
          Proxies to Gemini REST API; logs usage via usageLogger
Errors:   400 "Gemini API key not configured..." if no key
```

**`POST /v1/llm/claude`**
```
Body:     { model, max_tokens, messages, beta?, accelerator? }
Logic:    Fetches per-user claude_api_key from DB
          Adds anthropic-version: 2023-06-01 header
          If body.beta present → sets anthropic-beta header
          401 from upstream → returns 400 "invalid key"
```

**`POST /v1/llm/openai`**
```
Body:     { model, messages, response_format?, accelerator? }
Logic:    Fetches per-user openai_api_key from DB
          280s AbortSignal timeout → 504 on timeout
```

**`GET /v1/llm/stats`** _(requireAuth)_
```
Response: {
  summary: [{ provider, total_calls, total_input_tokens, total_output_tokens, total_cost_usd }],
  recent:  [last 10 log rows]
}
```

---

### Rationalizer Routes (`/v1/rationalizer`)

> **Important:** `/v1/rationalizer/embed` must be registered BEFORE multer middleware.

**`POST /v1/rationalizer`**
```
Multipart: files[] (array of PDFs)
Body:      { mode: 'exact'|'semantic', similarityThreshold: 70–99 }
Response:  { groups: [{ id, similarity, documents: [{ filename, pageCount }] }] }
```

**`POST /v1/rationalizer/embed`**
```
Body:     { texts: string[], apiKey?: string }
Response: { embeddings: number[][] }  (Gemini text-embedding-004)
```

---

### PDF Compare (`/v1/pdf-compare`)

**`POST /v1/pdf-compare`**
```
Multipart: fileA, fileB
Body:      { mode: 'semantic'|'exact' }
Response:  { totalDifferences, differences: [{ page, type, textA, textB, reason }] }
```

---

### PDF Exact Compare (`/v1/pdf-exact-compare`) _(requireAuth)_

**`POST /v1/pdf-exact-compare`**
```
Multipart: fileA, fileB
Body:      { mode: 'simple'|'precise' }
Response:  diff result with highlight regions
```

---

### External Compare API (`/v1/api`) _(HTTP Basic Auth)_

**`POST /v1/api`**
```
Multipart: fileA, fileB
Body:      { diffMode: 'simple'|'precise' }
Response:  {
  areDocumentsSame: 'Yes'|'No',
  differences: {
    difference: ExactDiff[]
  }
}

ExactDiff: {
  diffID:         string
  PageNumber:     number
  typeOfDiff:     'added'|'removed'|'modified'|'Font'|'Color'
  positionInPage: 'Top'|'Middle'|'Bottom'
  diffSeverity:   'Major'|'Minor'
  textA:          string
  textB:          string
  reason?:        string
}
```

---

### Data Mapping (`/v1/data-mapping`)

**`POST /v1/data-mapping`**
```
Multipart: docx (one or more), xsd (one)
Response:  { mappings: [{ field, xsdPath, sampleValue, templateName, pageNumber }], generatedXml }
```

---

### XPath Extractor (`/v1/xpath-extractor`)

**`POST /v1/xpath-extractor`**
```
Multipart: pdf, xml
Response:  [{ value, xpath, templateName, pageNumber, fieldType }]
```

---

### Synthetic Data (`/v1/synthetic-data`)

**`POST /v1/synthetic-data`**
```
Multipart: xsd (single)
Response:  { fields: [{ field, value }], generatedXml }
```

---

### Layout Recommendation (`/v1/layout-recommendation`)

**`POST /v1/layout-recommendation`**
```
Multipart: file (PDF or DOCX)
Response:  { emailVersion: string, whatsappVersion: string }
```

---

### GhostDraft Generator (`/v1/ghostdraft-generator`) _(requireAuth)_

**`POST /v1/ghostdraft-generator`**
```
Multipart: gd (required), csv (optional), xsd (optional), gdref (optional)
Body:      { provider: 'gemini'|'claude'|'openai' }
Response:  { gdContent, sampleXml, variableMap, skipped, unresolved }
```

Server-side pipeline (12 steps):
1. Parse `.gd` XML; mask RTF `\pict` blocks (binary image data)
2. Extract all fill points / variables from the template
3. Parse CSV for variable values (4-strategy detection: header match, pattern match, positional, fuzzy)
4. Heuristic GUID matching for GhostDraft internal references
5. XSD-tree-aware XML building for structured fields
6. LLM call for unresolved variables
7. Re-inject masked `\pict` blocks
8. Return enriched `.gd` XML

---

### Health Check

**`GET /v1/health`**
```
Response: { status: 'ok', timestamp: ISO string }
```

---

## 15. TypeScript Types

All in `types.ts`:

```typescript
interface FormField            { field: string; value: string }
interface SyntheticDataResult  { fields: FormField[]; generatedXml?: string }
interface XPathMapping         { value: string; xpath: string; templateName: string; pageNumber: string; fieldType: string }
interface DataMapping          { field: string; xsdPath: string; sampleValue: string; templateName: string; pageNumber: string }
interface DataMappingResult    { mappings: DataMapping[]; generatedXml: string }
interface ConsolidatedDataMapping { field: string; xsdPath: string; sampleValue: string; templateCount: number; templates: string[] }

interface Highlight {
  bbox: { left: number; top: number; width: number; height: number };
  tooltipContent: React.ReactNode;
  highlightKind?: 'diff'|'semantically-same'|'added'|'removed'|'modified'|'font'|'pixel-diff';
}
interface ComparisonDifference { page: number; highlightsA: Highlight[]; highlightsB: Highlight[] }

interface ProcessedDocument    { file: File; text: string; hash?: string; embedding?: number[]; thumbnail?: string }
interface DocumentGroup        { id: number; documents: ProcessedDocument[]; similarity: number }
interface ClauseOccurrence     { documentName: string; count: number }
interface ClauseMatch          { text: string; occurrences: ClauseOccurrence[]; totalCount: number; frequency: number }

interface LayoutRecommendationResult { emailVersion: string; whatsappVersion: string }

interface BusinessRule {
  fieldName: string; ruleType: 'Validation'|'Conditional'|'Calculation'|'Presentation';
  condition: string; actionFormula: string; errorMessage: string;
  dependentFields: string; priority: 'High'|'Medium'|'Low';
  sourceReference?: string; pageReference?: string;
}
interface BusinessRulesResult  { rules: BusinessRule[] }

interface TestCase {
  fieldSection: string; category: 'Happy Path'|'Mandatory'|'Boundary'|'Conditional'|'Format'|'Calculation';
  testDescription: string; inputData: string; expectedResult: string;
  priority: 'High'|'Medium'|'Low'; preconditions: string; testSteps: string;
}
interface TestCaseResult       { testCases: TestCase[] }

interface MockedXmlBundle      { testCaseIds: string[]; description: string; xmlContent: string }
interface MockedXmlsResult     { xmlBundles: MockedXmlBundle[] }

interface AccessibilityCriterion {
  id: string; standard: string; name: string;
  status: 'pass'|'fail'|'warning'|'not-applicable';
  level?: string; severity?: 'critical'|'major'|'minor';
  issue?: string; recommendation?: string;
}
interface AccessibilityStandard { name: string; score: number; criteria: AccessibilityCriterion[] }
interface AccessibilityResult {
  overallScore: number; grade: 'A'|'B'|'C'|'D'|'F';
  summary: string; standards: AccessibilityStandard[];
  criticalIssues: number; majorIssues: number; minorIssues: number;
  passed: number; totalChecked: number;
}
```

---

## 16. Config Files

### `vite.config.ts`

```typescript
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/v1': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        timeout: 120000,          // 2 min socket timeout
        proxyTimeout: 120000,     // 2 min upstream response timeout
      },
      '/api/gemini': {
        target: 'https://generativelanguage.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/gemini/, '/v1beta'),
      },
    },
  },
  define: {
    'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
  },
  resolve: { alias: { '@': '.' } },
});
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "allowJs": true,
    "allowImportingTsExtensions": true,
    "moduleResolution": "bundler",
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"],
    "experimentalDecorators": true,
    "useDefineForClassFields": false,
    "paths": { "@/*": ["./*"] }
  }
}
```

### `vercel.json`

```json
{
  "outputDirectory": "dist",
  "rewrites": [
    { "source": "/v1/:path*", "destination": "/api/index" }
  ],
  "functions": {
    "api/index.ts": { "maxDuration": 300 }
  }
}
```

All `/v1/*` API calls are rewritten to the single serverless function `api/index.ts`. Static frontend is served from `dist/`.

### `index.html` (key features)

```html
<!-- Tailwind CSS via CDN — no PostCSS pipeline -->
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config = { darkMode: 'class' }</script>

<!-- Import map for browser-native ESM -->
<script type="importmap">
{
  "imports": {
    "react": "https://esm.sh/react@19.2.0",
    "react-dom/client": "https://esm.sh/react-dom@19.2.0/client",
    "pdfjs-dist": "https://esm.sh/pdfjs-dist@5.4.624",
    "diff": "https://esm.sh/diff@8.0.2",
    "@google/genai": "https://esm.sh/@google/genai"
  }
}
</script>

<script type="module" src="/index.tsx"></script>
```

### `.gitignore`

Ignores: `node_modules/`, `dist/`, `dist-sr/`, `*.local` (including `.env.local`), `.vscode/*` (except `extensions.json`), `.vercel/`

### `package.json` scripts

```json
{
  "scripts": {
    "dev":     "concurrently \"vite\" \"tsx watch server/index.ts\"",
    "dev:ui":  "vite",
    "dev:api": "tsx watch server/index.ts",
    "build":   "vite build",
    "lint":    "tsc --noEmit",
    "preview": "vite preview"
  }
}
```

---

## 17. Vercel Deployment

**Architecture:** Dual-entry deployment
- `dist/` — static frontend built by Vite
- `api/index.ts` — single serverless function handling all `/v1/*` API calls

**Deploy steps:**
1. Install Vercel CLI: `npm i -g vercel`
2. `vercel link` (link to project)
3. Set all environment variables via Vercel dashboard or `vercel env add`
4. `vercel deploy --prod` — Vite builds frontend → `dist/`; Vercel compiles `api/index.ts`
5. All `/v1/*` requests are rewritten to `api/index.ts` (maxDuration: 300s)

**Cold-start validation:** `api/index.ts` checks `PGHOST`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`, `JWT_SECRET` at cold start. Missing any returns `HTTP 500` with a descriptive error message before any handler runs.

**Warm invocations:** A module-level `initialized` flag prevents `initDb()` from running on every request.

**Runtime:** Fluid Compute (default Node.js, not Edge). Full Node.js APIs available. Streaming works without `runtime = 'edge'`.

---

## 18. AI Provider Model Defaults & Pricing

### Default Models

| Provider | Default Model | localStorage key |
|---|---|---|
| Gemini | `gemini-2.5-flash` | `dih_settings.geminiModel` |
| Claude | `claude-haiku-4-5-20251001` | `dih_settings.claudeModel` |
| OpenAI | `gpt-4o-mini` | `dih_settings.openaiModel` |

### Supported Models (with pricing tracked in `usageLogger.ts`)

**Gemini:** `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.0-flash`, `gemini-1.5-flash`, `gemini-1.5-pro`

**Claude:** `claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, `claude-opus-4-8`, `claude-3-5-haiku-20241022`, `claude-3-5-sonnet-20241022`

**OpenAI:** `gpt-4.1`, `gpt-4.1-mini`, `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-3.5-turbo`

### Per-Task LLM Tier Usage

| Task | Gemini | Claude | OpenAI |
|---|---|---|---|
| Synthetic data, layout, accessibility, test cases | `gemini-2.5-flash` | `claude-haiku-4-5-20251001` | `gpt-4o-mini` |
| XPath extraction, data mapping | `gemini-2.5-flash` | `claude-sonnet-4-6` | `gpt-4o-mini` |

---

## 19. Development Rules

### Accelerator Isolation (Critical)

Fixing or modifying one accelerator **must not** break another. Each accelerator is self-contained. Always verify that a change scoped to one tool has no side effects on others.

### Shared Code Changes

If a fix requires modifying shared files (`services/geminiService.ts`, `services/claudeService.ts`, `services/llmService.ts`, `ResultsTable.tsx`, `FileUploader.tsx`, `types.ts`, server middleware, or **any file used by more than one accelerator**):

**Do NOT edit the shared file.** Instead:
1. Create an accelerator-specific copy of the relevant function/component/module
2. Apply the change only in the copy
3. Reference the original shared code from all other accelerators unchanged

### Single-SPA Mount Strategy

All tool components are mounted simultaneously and shown/hidden via `className`. Do not restructure to conditional rendering without confirming state persistence is acceptable for that tool.

### Route Registration Order

In `server/app.ts`: the `/v1/rationalizer/embed` endpoint must be registered **before** multer middleware on the rationalizer router, or multer will consume the JSON body first.

### GhostDraft Is Different

`GhostDraftGenerator.tsx` is the only component that bypasses `llmService.ts`. It POSTs directly to `/v1/ghostdraft-generator`. All provider routing for GhostDraft is server-side. Do not apply `llmService` patterns to it.

### Accessibility Scorer Truncation

`AccessibilityScorer.tsx` hard-truncates extracted PDF text at **4000 characters** before sending to LLM. This is intentional to stay within token limits. Do not remove.

### FieldExtractor Fallback

`FieldExtractor.tsx` has a silent `parseFieldsFromXml()` fallback when the LLM returns an empty `fields` array. This is intentional.

### DataMappingGenerator Sentinel

When an XSD XPath cannot be found, DataMappingGenerator uses `"path not found"` as the sentinel `xsdPath` string. This is meaningful in downstream consolidation logic.

---

## 20. Commands Reference

```bash
npm install          # Install dependencies
npm run dev          # Start Vite (:3000) + Express (:3001) concurrently
npm run dev:ui       # Vite dev server only
npm run dev:api      # Express API server only (tsx watch)
npm run build        # Production build → dist/
npm run lint         # TypeScript type check (tsc --noEmit)
npm run preview      # Preview production build
```

**Default credentials:** `admin` / `Admin@123`

**Ports:** Frontend → `http://localhost:3000` | API → `http://localhost:3001`

**Key localStorage keys:**
- `dih_auth` — `{ user: ClientUser, token: string }`
- `dih_settings` — `AppSettings` (theme, llmProvider, API keys, model selections)
