# Server Routes — Accelerator Quick Reference

All routes are registered in `server/app.ts`. Auth middleware lives at `server/middleware/auth.ts`. DB pool at `server/db.ts` (Neon Postgres). Multer is used for file uploads (memory storage — all files arrive as `Buffer` in `req.files`).

**Only two routes require auth**: `/v1/ghostdraft-generator` and `/v1/pdf-exact-compare`.

---

## rationalizer.ts → `/v1/rationalizer`

**Method**: POST, multipart `files[]` (array)

**Params**: `mode` ('exact'|'semantic'), `similarityThreshold` (int 70–99)

**Pipeline**:
1. `extractFullText(buffer)` from `../lib/pdf.js` per file
2. Semantic: `generateKeywordEmbedding(text)` — **word-hash 768-dim vectors, NOT Gemini API**; cosine similarity → greedy clustering at threshold
3. Exact: `crypto.createHash('sha256')` of normalized text; identical hashes → same group

**Returns**: `{ groups: GroupResult[] }` — `{id, similarity, documents:[{filename, pageCount}]}`

**Separate endpoint**: `POST /v1/rationalizer/embed` — accepts `{texts: string[], apiKey?}` JSON; proxies to Gemini `text-embedding-004:batchEmbedContents`; returns `{embeddings: number[][]}`. This is the only real Gemini embeddings call; the component doesn't use it.

**LLM**: None in main route. Real embeddings only via `/embed` sub-route.

**Gotcha**: Route registration order matters — `/embed` must be registered before the multer file-upload middleware or the JSON body parser conflicts.

---

## pdfCompare.ts → `/v1/pdf-compare`

**Method**: POST, multipart `fileA` + `fileB`

**Params**: `mode` ('semantic'|'exact')

**Pipeline**:
- Semantic: `extractPagesText()` from `../lib/pdf.js` → `callGemini('gemini-2.5-flash', SEMANTIC_COMPARE_PROMPT)` with structured JSON schema → `{textA, textB, reason, kind}` array
- Exact: `diffWordsWithSpace(textA, textB)` (npm `diff`) → classify removed/added/modified

**Returns**: `{ totalDifferences: number, differences: PageDiff[] }` — `{page, type, textA, textB, reason}`

**LLM**: Gemini `gemini-2.5-flash` (semantic mode only). `SEMANTIC_COMPARE_PROMPT` imported from `../gemini.js`.

---

## pdfExactCompare.ts → `/v1/pdf-exact-compare`

**Auth**: `requireAuth` middleware required.

**Method**: POST, multipart `fileA` + `fileB`

**Params**: `mode` ('simple'|'precise')

**Pipeline**: Word-level diff using `diffWordsWithSpace` (npm `diff`). Precise mode: renders pages to canvas, pixel-block comparison (10px grid, >5% diff threshold).

**Returns**: Diff result with highlight regions for both documents.

**LLM**: None — purely deterministic.

---

## dataMapping.ts → `/v1/data-mapping`

**Method**: POST, multipart `docx` + `xsd`

**Pipeline**:
1. `extractDocxText()` from `../lib/pdf.js`
2. `callGemini('gemini-2.5-flash', DATA_MAPPING_PROMPT)` with structured schema response

**Returns**: `{ mappings: [{field, xsdPath, sampleValue, templateName, pageNumber}], generatedXml }`

**LLM**: Gemini `gemini-2.5-flash`. Note: CLAUDE.md says pro for data mapping but the actual code uses flash.

**Note**: Component typically calls llmService directly (client-side path) and bypasses this route. Route exists for direct API usage.

---

## xpathExtractor.ts → `/v1/xpath-extractor`

**Method**: POST, multipart `pdf` + `xml`

**Pipeline**:
1. PDF buffer → base64 (`pdfBase64`)
2. XML buffer → string
3. `callGemini('gemini-2.5-flash', XPATH_PROMPT, {inlineData:{mimeType:'application/pdf', data:pdfBase64}})` — **PDF sent as multimodal inline document, not text-extracted**
4. Structured schema response: `[{value, xpath, templateName, pageNumber, fieldType}]`

**Returns**: Parsed JSON array of XPath mappings.

**LLM**: Gemini `gemini-2.5-flash` with multimodal PDF input.

---

## syntheticData.ts → `/v1/synthetic-data`

**Method**: POST, multipart single `xsd` via `upload.single('xsd')`

**Pipeline**: `callGemini('gemini-2.5-flash', SYNTHETIC_DATA_PROMPT)` with structured schema response.

**Returns**: `{ fields: [{field, value}], generatedXml }`

**LLM**: Gemini `gemini-2.5-flash`.

**Note**: Bundle mode (test case CSV) is handled entirely client-side via llmService; this route handles the basic single-XSD case only.

---

## layoutRecommendation.ts → `/v1/layout-recommendation`

**Method**: POST, multipart single `file`

**Pipeline**:
1. Branch on `path.extname(file.originalname).toLowerCase()` for `.pdf` vs `.docx`
2. `callGemini('gemini-2.5-flash', LAYOUT_PROMPT)` with structured schema

**Returns**: `{ emailVersion: string, whatsappVersion: string }`

**LLM**: Gemini `gemini-2.5-flash`. Prompt specifies: email = subject + 2–4 paragraphs; WhatsApp = 5–7 lines, critical info only.

---

## ghostDraftGenerator.ts → `/v1/ghostdraft-generator`

**Auth**: `requireAuth` middleware required.

**Method**: POST, multipart fields: `gd` (required), `csv` (optional), `xsd` (optional), `gdref` (optional). Plus `provider` in body (`'gemini'`|`'claude'`|`'openai'`).

**API keys**: Fetched from Postgres `users` table per `userId`. Env vars (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`) are fallback only.

**LLM tiers**: Gemini `gemini-2.5-flash` / Claude `claude-haiku-4-5-20251001` / OpenAI `gpt-4o-mini`.

---

### Key Functions (in declaration order)

#### `maskRtfPictBlocks(rtf)`
Replaces `{\pict...}` image groups with `\x00PICTn\x00` sentinel tokens. Uses brace-depth parsing (NOT regex) to find group boundaries — walks back from `\pict` to find opening `{`, then counts nested `{`/`}` (skips `\\` escapes) to find matching `}`. Returns `{masked, restore}` closure.

**Why**: RTF `\pict` blocks contain hex-encoded binary data that pattern-matches bracket sequences, causing false variable detection and image corruption.

#### `normalizeRtfBracketSpaces(rtf)`
Masks pict blocks first, then strips leading/trailing spaces inside bracket placeholders: `[ foo ]`→`[foo]`, `< foo >`→`<foo>`. Applied to `baseRtf` before all detection.

**Regex note**: `\[\s+([A-Za-z]...)` requires at least one leading space to trigger (i.e., `[foo]` unchanged, `[ foo]` → `[foo]`).

#### `extractRtfFromGd(gdXml)`
Parses `.gd` XML to extract embedded RTF. Tries `<rtf><![CDATA[...]]></rtf>` first; falls back to plain `<rtf>...</rtf>` with XML entity decoding.

#### `extractRawTextFromRtf(rtf)`
Masks pict blocks; strips RTF control codes via 3 passes of `{\*...}` removal, `\'xx` hex escapes, `\word` control words, then `{}` chars. Does NOT call any LLM.

#### `detectVariables(rawText, rows)` — deterministic (CSV) mode
Four strategies per CSV row, in order:

| Step | Strategy | Example match |
|---|---|---|
| 1 | CSV label already bracket-wrapped; exact search | `<Policy Number>` in CSV → search as-is |
| 2 | Wrap plain label in bracket variants | CSV `"Policy Number"` → try `<Policy Number>`, `[Policy Number]`, `< Policy Number>` |
| 2.5 | Normalized doc-side: replace hyphens with spaces in each doc bracket, collapse, compare case-insensitively to CSV label | doc `[support-email]` → `"support email"` == CSV `"support email"` |
| 3 | Sample value literal | CSV sampleValue `"Deloitte Insurance Company"` found verbatim in text |

No LLM fallback. If all 4 strategies fail → field goes to `skipped` list.

#### `autoDetectVariables(rawText)` — no-CSV mode
Regex: `/[\[<]\s*([A-Za-z][^\[\]<>\n\r]*?)\s*[\]>]/g`. First word of inner text → domain heuristic. Fills `fillPointId` sequentially from 1.

#### `heuristicMatch(row, instructions)`
Matches a detected variable to a `GdInstruction` from the reference `.gd`:
1. `gdDomainHint(xsdPath)`: maps XSD second segment → GhostDraft domain (`contact`→Person, `claim`→Claim, `policy`|`support`→Company)
2. Builds candidates: all PascalCase suffix combinations of XSD path segments beyond root+domain, plus `cleanedLabel` (field label split + PascalCase)
3. Checks domain-filtered instructions first, then global; `nodeName.toLowerCase()` exact match

**No LLM fallback** — a wrong guess is worse than no guess.

#### `assignResolvedNodes(detected, instructions)`
Calls `heuristicMatch()` per variable; sets `v.resolved = {domain, domainGuid, nodeName, nodeGuid}`. If no match, `v.resolved` stays `undefined`.

**Guard**: After this, variables with `v.resolved === undefined` are **filtered out of `allDetected`** before substitution (when reference `.gd` is provided). This prevents XSD-derived fallback tags (e.g. `AdjudicatorContactEmail of Claim`) from being written into the `.gd` for non-existent nodes.

#### `applySubstitutionsToRtf(rtf, variables)`
Masks pict blocks; replaces each bracket occurrence with `%[N]` markers. Each occurrence gets a unique fill-point ID — first occurrence uses `v.fillPointId`, subsequent ones use `nextId++` (starts at max existing ID + 1). 0-occurrence variables are NOT added to `allVariables` (avoids dangling XML instructions with no `%[N]` marker in RTF).

#### `buildGdXml(docName, rtf, variables)`
Generates GhostDraft 5.3 XML. Contains hardcoded UUIDs for annotation style references — these are GhostDraft format constants. Uses `v.resolved` for domain/GUID/node when available; falls back to XSD-derived values only when no reference `.gd` was provided.

#### `buildSampleXml(rows, xsdText)`
XSD-tree-aware via `parseXsdTree()`: respects `xs:sequence` order, `minOccurs`, resolves named types. `xsdLeafDefault()` generates type-appropriate defaults: `xs:date`→ISO date, `xs:decimal`→`'0'`, `xs:boolean`→`'false'`.

#### `findUnresolvedPlaceholders(rtf)`
Scans output RTF (after substitution) for remaining bracket patterns using the same regex as `autoDetectVariables`. Masks pict blocks first to avoid false positives from image data.

---

### Route Handler Pipeline (in order)

```
1. extractRtfFromGd(gdXml)
2. normalizeRtfBracketSpaces(rtf)          ← masks pict, trims bracket spaces, restores
3. extractRawTextFromRtf(baseRtf)          ← masks pict, strips RTF codes
4. detectVariables(rawText, rows)          ← deterministic, OR
   autoDetectVariables(rawText)            ← auto-detect (no CSV)
5. parseGdFile(gdRefBuffer)                ← parse reference .gd instructions (if provided)
6. assignResolvedNodes(allDetected, ...)   ← heuristic GUID match
7. allDetected = allDetected.filter(v => v.resolved !== undefined)  ← guard (if ref .gd provided)
8. applySubstitutionsToRtf(baseRtf, allDetected)
9. buildGdXml(docName, substitutedRtf, allVariables)
10. buildSampleXml(rows, xsdText)
11. findUnresolvedPlaceholders(substitutedRtf)
12. return {gdContent, sampleXml, variableMap, skipped, unresolved}
```

---

## llm.ts → `/v1/llm/gemini` and `/v1/llm/claude`

**Auth**: Checked implicitly via API key lookup (not `requireAuth` middleware).

**Purpose**: Server-side proxy for all client-side LLM calls. Fetches per-user API key from Postgres (`gemini_api_key` / `claude_api_key` columns on `users` table); falls back to env vars.

**Gemini path**: Forwards to `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`. Supports `responseSchema` and `responseMimeType` from request body.

**Claude path**: Forwards to `https://api.anthropic.com/v1/messages`. Supports `beta` field in body (for PDF beta header). Adds `anthropic-version: 2023-06-01` header.

**Key behaviour**: API key is injected server-side — client never receives or stores the raw key.

---

## auth.ts → `/v1/auth`

**POST `/v1/auth/login`**: validates credentials against Postgres `users` table (bcrypt); issues JWT signed with `JWT_SECRET` env var; returns `{token, user}`.

**Middleware** (`server/middleware/auth.ts`): `requireAuth` verifies JWT, sets `req.user = {id, email, role}`. Only applied to `ghostdraft-generator` and `pdf-exact-compare` routes explicitly.

---

## Shared Server Utilities

| Module | Purpose |
|---|---|
| `server/lib/pdf.js` | `extractFullText()`, `extractPagesText()`, `extractDocxText()` — pdfjs-dist + mammoth wrappers |
| `server/gemini.js` | Prompt constants (`SEMANTIC_COMPARE_PROMPT`, `DATA_MAPPING_PROMPT`, etc.) and `callGemini()` helper |
| `server/db.ts` | Neon Postgres pool (`pool`) — used for API key lookup and user auth |
| `server/middleware/auth.ts` | `requireAuth` — JWT verification, sets `req.user` |
