# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server on port 3000
npm run build        # Production build
npm run lint         # TypeScript type check (tsc --noEmit)
npm run preview      # Preview production build
```

**Required**: Create `.env.local` with `GEMINI_API_KEY=<your-key>` before running.

## Architecture

**Entry point**: `index.html` → `index.tsx` → `App.tsx`

`App.tsx` is the shell with tab-based navigation routing to five self-contained accelerator tools. Each tool manages its own state; there is no global state manager.

### Tools (in `/components`)

| Component | Purpose | Inputs |
|---|---|---|
| `Rationalizer.tsx` | Groups similar PDFs by hash or semantic embedding | Multiple PDFs |
| `PdfCompare.tsx` | Side-by-side exact and semantic diff of two PDFs | Two PDFs |
| `DataMappingGenerator.tsx` | Maps Word doc fields to XSD schema, generates XML | DOCX + XSD |
| `XPathExtractor.tsx` | Extracts PDF data and maps to XML XPath locations | PDF + XML |
| `FieldExtractor.tsx` | Generates synthetic data from an XSD schema | XSD |
| `LayoutRecommendation.tsx` | Reformats a customer communication document into optimised Email and WhatsApp versions | PDF or DOCX |
| `AccessibilityScorer.tsx` | Scores a PDF against WCAG 2.1 Level A/AA criteria | PDF |

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

### Document Processing

- **PDF**: `pdfjs-dist` for text extraction and page rendering; PDF data sent to Gemini as base64
- **DOCX**: `mammoth` for text extraction
- **XSD/XML**: Passed as raw text in prompts
- **Clustering** (Rationalizer): Agglomerative hierarchical clustering on embedding vectors

### Shared Components

`FileUploader.tsx` handles drag-and-drop with file type validation. `ResultsTable.tsx` renders tabular AI output. `types.ts` holds all shared TypeScript interfaces.

## Key Config

- `vite.config.ts`: Dev server binds to `0.0.0.0:3000`, passes `GEMINI_API_KEY` from env to client via `define`
- `tsconfig.json`: ES2022 target, `@/*` path alias resolves to project root
- `metadata.json`: Google AI Studio metadata (app name/description, no frame permissions required)
- Tailwind CSS is loaded via CDN in `index.html` — no PostCSS pipeline
