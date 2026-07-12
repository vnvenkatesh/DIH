# Components — Accelerator Quick Reference

Each accelerator is a self-contained React component in this directory. They share `AuthContext` (JWT) and `SettingsContext` (llmProvider, API keys) via hooks. All LLM calls route through `services/llmService.ts` except GhostDraftGenerator (which POSTs directly to its own route).

---

## Rationalizer.tsx

**Purpose**: Groups multiple PDFs by content similarity; surfaces repeated and unique clauses.

**Inputs**: Multiple PDFs, `groupingMode` ('exact'|'semantic'), `similarityThreshold` (70–99), optional `onCompareRequest` prop from App.tsx.

**Key state**: `files`, `groupingMode`, `similarityThreshold`, `results` (DocumentGroup[]), `repeatedClauses` (ClauseMatch[]), `uniqueClausesByGroup`, `groupSummaries`, `activeTab`.

**Critical path** (`handleProcess()`):
1. `processPdf(file)` → pdfjs-dist text per file
2. Semantic: `embedContentBatch(texts)` from llmService → **client-side keyword hash vectors only, no API call**
3. Cosine similarity matrix → greedy agglomerative clustering at `threshold/100`; similarity capped at 99 (`Math.min(sim*100, 99)`)
4. Exact: `crypto.subtle.digest('SHA-256', normalizedText)` per file; identical hashes → same group
5. `detectRepeatedClauses()`: Jaccard on 3-sentence sliding windows, step 2, threshold `CLAUSE_JACCARD_THRESHOLD = 0.65`

**API**: No server call in the main flow. `/v1/rationalizer/embed` exists for real Gemini embeddings but is not called by the component.

**LLM**: None in primary pipeline. `embedContentBatch` is a pure word-hash function (768-dim vectors), NOT the Gemini embeddings API.

**Integration**: `onCompareRequest([File, File])` feeds into PdfCompare via App.tsx `initialFiles` prop.

**Exports**: `exportClausesCSV()`, `exportMasterDocument()` (self-contained HTML with TOC).

---

## PdfCompare.tsx

**Purpose**: Side-by-side PDF comparison with AI semantic diff or client-side exact diff.

**Inputs**: `pdfFileA`, `pdfFileB`, `comparisonMode` ('semantic'|'exact'), `exactDiffMode` ('simple'|'precise'). Accepts `initialFiles?: [File, File]` prop from Rationalizer.

**Key state**: `pdfDocA`/`pdfDocB` (PDFDocumentProxy), `results` (ComparisonDifference[]), `flatDifferences` (FlatDifference[]), `currentDifferenceIndex`, `activeTooltip`, `hasCompared` (ref).

**Critical path** (`handleCompare()`):
- Semantic: pdfjs text extraction → `performSemanticComparison(textA, textB)` from llmService → bounding boxes via `findBboxForSnippet()` (substring search in pdfjs text items)
- Exact: `groupIntoParagraphs()` → `diffArrays()` (npm `diff`) → classify added/removed/modified
- Precise: `findPixelDiffRegions()` — renders pages to canvas, 10px block grid, >5% pixel diff → purple highlights (expensive)

**API**: Semantic → `llmService.performSemanticComparison` → `/v1/llm/gemini` or `/v1/llm/claude`. Exact → fully client-side.

**LLM**: Gemini `gemini-2.5-flash` / Claude `claude-haiku-4-5-20251001`.

**Highlight colors**: semantically-same=green, added=blue, removed=red, modified=yellow, font-size-diff=orange, pixel-diff=purple.

**Sync scroll**: `viewerARef`/`viewerBRef` + `handleScroll()` (proportional). Consumes `initialFiles` once via `onInitialFilesConsumed()` callback to prevent re-init loops.

**Gotcha**: `findBboxForSnippet()` is substring-only — multi-line snippets spanning pdfjs item boundaries may not highlight. Auto re-compare triggers when `comparisonMode`/`exactDiffMode` changes if `hasCompared.current === true`.

---

## PdfVisualCompare.tsx

**Purpose**: Word-level diff with DP page matching — handles page insertions/deletions. No LLM. Fully client-side.

**Inputs**: `fileA`, `fileB`, `exclusionInput` (comma/newline strings to strip), `diffMode` ('simple'|'precise').

**Key state**: `pdfDocA`/`pdfDocB`, `pageResults` (PageResult[]), `summary` (Summary), `navList` (string[]), `navIndex`, `controlsCollapsed`, `summaryCollapsed`.

**Critical path** (`handleCompare()`):
1. `extractPageWords(pdfDoc, exclusions)` in parallel — pdfjs items; char X estimated as `charW = item.width / charCount`; punctuation merged into preceding token
2. `buildParagraphs()` — global paragraph bag for page-shift suppression
3. `matchPages(bagsA, bagsB)` — DP, `sim[i][j] = jaccard(bagsA[i-1], bagsB[j-1])`, `MATCH_THRESHOLD = 0.25`; traceback: 1=match, 2=skipA, 3=skipB
4. Per matched pair: `diffLines()` (paragraph LCS → `diffWordsWithSpace`) + optional pixel diff
5. `mergeRunHighlights()` — merges adjacent same-type highlights on same line (within 70% height, gap ≤ 1.2× line height)

**Precise mode**: `checkWordStyleReasons()` — `colorBucket()` maps pixel average → 'light'/'red'/'warm'/'blue'/'green'/'dark'; strips `ABCDEF+` and `g_d0_` font name prefixes from pdfjs.

**3 normalization functions**: `normForCompare` (NFKC+whitespace), `normForLineIdentity` (alpha+spaces only), `normForParaIdentity` (alpha only).

**Navigation**: `navList` = ordered nav IDs; `navigate(1|-1)` scrolls both L- and R- paired DOM elements.

**Gotcha**: `exclusionInput` applies to BOTH docs before diff. `MATCH_THRESHOLD = 0.25` is intentionally low for sparse pages. Font name prefix stripping is essential — pdfjs reports subset font names like `ABCDEF+Arial`.

---

## DataMappingGenerator.tsx

**Purpose**: Extracts variable fields from DOCX templates, maps to XSD XPaths, generates XML. Produces a consolidated cross-template field inventory.

**Inputs**: `docxFiles` (one or more DOCX/text), `xsdFile`.

**Key state**: `fileProgress` (FileProgress[] with status 'pending'|'processing'|'done'|'error'), `consolidated` (ConsolidatedDataMapping[]), `generatedXml`.

**Critical path** (`handleProcess()`):
1. Sequential loop per file: `fileToString(file)` — mammoth `convertToHtml()` for .docx (preserves table structure), FileReader for plain text
2. `htmlToStructuredText(html)` — 2-col tables → `"label: value"` lines; multi-col → `"header: cell"` lines
3. `generateDataMap(docxContent, xsdContent, file.name)` from llmService
4. `consolidateMappings(allMappings)`: keys by `normalizeKey(fieldName)` → `mostCommon(xsdPaths)` wins; groups `templateName` per field; sorts by `templateCount DESC`

**Sub-component**: `TemplatesBadge` — click to expand popover listing template names per field.

**API**: `llmService.generateDataMap` → `/v1/llm/gemini` or `/v1/llm/claude`.

**LLM**: Gemini `gemini-2.5-flash` / Claude `claude-sonnet-4-6` (higher tier — complex structured extraction).

**Exports**: `handleDownloadCsv()`, `handleDownloadXml()` with `formatXml()` pretty-printer. `generatedXml` reflects first file only — no XML merge.

**Gotcha**: `normalizeKey()` lowercases, replaces `_-` with space, splits camelCase, removes punctuation — "PolicyNumber" and "policy_number" deduplicate together. Processing is sequential (not parallel) to enable per-file progress. Prompt instructs: set `xsdPath = "path not found"` sentinel when no match; exports filter on this value.

---

## XPathExtractor.tsx

**Purpose**: Maps each visible PDF value to its full absolute XPath in a corresponding XML file.

**Inputs**: `pdfFile`, `xmlFile`.

**Key state**: `pdfFile`, `xmlFile`, `results` (XPathMapping[]).

**Critical path** (`handleProcess()`):
1. `fileToBase64(pdfFile)` — raw PDF binary as base64
2. `fileToString(xmlFile)` — XML as text
3. `extractXPaths(pdfBase64, pdfFile.type, xmlContent, pdfFile.name)` from llmService

**API**: `llmService.extractXPaths` → `/v1/llm/gemini` or `/v1/llm/claude`.

**LLM**:
- Gemini: `gemini-2.5-flash` — PDF sent as multimodal `inlineData` part (visual, not text extraction)
- Claude: `claude-sonnet-4-6` with `anthropic-beta: pdfs-2024-09-25` — PDF as `{type:'document', source:{type:'base64', ...}}`

**Display**: `ResultsTable` shared component. Export CSV: Template Name, Page Number, Field Type, Value from PDF, XPath.

**Gotcha**: Only accelerator that passes raw PDF binary to LLM (no pdfjs text extraction). `pdfFile.name` becomes `templateName` in results. Claude PDF beta header is serialized into the request body as a `beta` field (not HTTP header) when going through `/v1/llm/claude` proxy.

---

## FieldExtractor.tsx (exported as `SyntheticDataGenerator`)

**Purpose**: Generates synthetic XML from XSD schema; with a test cases CSV input, produces per-category XML bundles.

**Inputs**: `xsdFile` (required), `testCasesCsvFile` (optional — from TestCaseGenerator export).

**Key state**: `xsdFile`, `testCasesCsvFile`, `extractedData` ({field,value}[]), `generatedXml`, `xmlBundles` (MockedXmlBundle[]), `testCaseRows` (ParsedRow[]).

**Basic mode** (no CSV, `handleProcess()`):
1. `generateSyntheticDataFromXsd(xsdContent)` from llmService
2. `parseFieldsFromXml(generatedXml)` fallback — DOM-parses LLM XML and extracts leaf nodes when `fields` array is empty

**Bundle mode** (with CSV):
1. `parseCsv(csvText)` → `validateTestCasesCsv(rows)` — requires `TC_CSV_REQUIRED` headers matching TestCaseGenerator export format
2. `serializeTestCases(rows)` → text block
3. `generateMockedXmlsFromTestCases(xsdContent, testCasesText)` from llmService
4. `BundleCard[]` — one per test case category; shows colored category badges, expandable XML preview, per-bundle download

**API**: `llmService.generateSyntheticDataFromXsd` or `generateMockedXmlsFromTestCases` → `/v1/llm/gemini` or `/v1/llm/claude`.

**LLM**: Gemini `gemini-2.5-flash` / Claude `claude-haiku-4-5-20251001`.

**`CATEGORY_COLORS`**: Happy Path=green, Mandatory=red, Boundary=yellow, Conditional=purple, Format=blue, Calculation=orange.

**Gotcha**: `parseFieldsFromXml()` fallback silently activates with no user notification. The `TC_CSV_REQUIRED` headers are coupled to TestCaseGenerator's export column format — any column rename breaks the pipeline. Component is named `FieldExtractor.tsx` but exported as `SyntheticDataGenerator`.

---

## LayoutRecommendation.tsx

**Purpose**: Reformats a customer communication document into an optimised email and WhatsApp message.

**Inputs**: Single PDF, DOC, or DOCX file.

**Key state**: `file`, `result` (`{emailVersion, whatsappVersion}`).

**Critical path** (`handleProcess()`):
1. PDF → `extractTextFromPdf(file)` via pdfjs-dist. DOCX → mammoth `extractRawText()` (plain text, no HTML)
2. `generateLayoutRecommendations(text)` from llmService — full text, no truncation

**API**: `llmService.generateLayoutRecommendations` → `/v1/llm/gemini` or `/v1/llm/claude`.

**LLM**: Gemini `gemini-2.5-flash` / Claude `claude-haiku-4-5-20251001`. Prompt: email = subject + 2-4 paragraphs (`\n\n` separated); WhatsApp = 5-7 lines (`\n` separated), critical info only.

**Display**: Two `OutputCard` sub-components (email: blue border, WhatsApp: green border) each with `CopyButton` (`navigator.clipboard.writeText()` with `document.execCommand('copy')` fallback).

**Gotcha**: No text length limit — very long documents pass full text. mammoth uses `extractRawText()` here (not `convertToHtml()`), so table structure is lost. Newline format instructions in the prompt use escaped literals (`\\n\\n`) that the LLM must interpret as actual newlines in the returned JSON.

---

## AccessibilityScorer.tsx

**Purpose**: WCAG 2.1 Level A/AA text-based audit of a PDF; produces overall score (0–100), letter grade (A–F), and per-criterion pass/fail/warning with recommendations.

**Inputs**: Single PDF file.

**Key state**: `file`, `result` (AccessibilityResult), `pdfMeta` (`{name, sizeKb, pages, analyzedChars}`).

**Critical path** (`handleScore()`):
1. `extractTextFromPdf(file)` via pdfjs-dist
2. Hard truncation: `text.slice(0, 4000)` — **only first ~2 pages analyzed**
3. `scoreAccessibility(text, file.name)` from llmService

**API**: `llmService.scoreAccessibility` → `/v1/llm/gemini` or `/v1/llm/claude`. No dedicated server route — goes directly through the LLM proxy.

**LLM**: Gemini `gemini-2.5-flash` / Claude `claude-haiku-4-5-20251001`. Gemini path does NOT use `responseSchema` — relies on `cleanJson()` post-processing (strips ` ```json ``` ` fences or finds `{...}` boundary). All other Gemini service calls use structured schema.

**Display**:
- `ScoreGauge`: SVG circle; ≥80=green, ≥60=amber, ≥40=orange, else red
- Grade: A(90–100), B(75–89), C(60–74), D(40–59), F(0–39)
- `CriterionRow`: accordion sorted fail→warning→pass→N/A; `severityBadge` critical=red, major=orange, minor=amber

**Gotcha**: `pdfMeta.analyzedChars = Math.min(fullText.length, 4000)` — shown in UI so user knows coverage. Visual checks (alt text, contrast, tagged structure) are instructed as `"warning"` but LLM may still produce `"fail"`. `_fileName` param is unused.

---

## GhostDraftGenerator.tsx

**Purpose**: Converts a GhostDraft `.gd` template into a variable-mapped `.gd` XML with fill point instructions; substitutes bracket placeholders resolved from CSV, XSD, and reference `.gd`.

**Inputs**: `gdFile` (required `.gd`), `csvFile` (optional — deterministic mode), `xsdFile` (optional — sample XML generation), `gdRefFile` (optional — GUID reuse).

**Key state**: `gdFile`, `csvFile`, `xsdFile`, `gdRefFile`, `result` (GenerationResult: `{gdContent, sampleXml, variableMap, skipped, unresolved}`).

**Critical path** (`handleGenerate()`):
1. Builds `FormData` with `gd`, optional `csv`/`xsd`/`gdref`, and `provider` from `useSettings()`
2. `fetch('/v1/ghostdraft-generator', {method:'POST', headers:{Authorization:'Bearer '+token}})` — uses `useAuth()` JWT directly; does NOT route through llmService
3. Stores `result`

**Mode detection**: `isAutoDetect = !csvFile`.

**Display**: summary banner (fill-point count + unresolved count in red), unresolved placeholder pills (red monospace), variable mapping table (ID/fieldLabel/domain/fieldName/xsdPath/sampleValue/detectionMethod/gdMatched), workflow tip.

**`DOMAIN_COLORS`**: Claim=blue, Company=purple, Person=green.

**Downloads**: `${baseName}.gd` and `${baseName}-sample.xml`.

**`handleNewDocument()`**: clears only `gdFile` + `result`; CSV/XSD/gdRef persist for reuse.

**Gotcha**: This is the ONLY accelerator that does NOT use llmService — it calls the server route directly. Server handles all provider routing internally. Auth (`useAuth()` JWT) is required; route is protected by `requireAuth` middleware.

---

## TestCaseGenerator.tsx

**Purpose**: Takes a CSV of business rules and generates categorized test cases (happy path, mandatory, boundary, conditional, format, calculation) consumable by FieldExtractor's bundle mode.

**Inputs**: `file` (CSV with `['Field Name', 'Rule Type']` columns), `hints` (optional free-text textarea).

**Key state**: `rules` (ParsedRule[]), `parseError`, `hints`, `cases` (IndexedTestCase[] — extends TestCase with `id: string` like "TC-001"), `activeFilter` (FilterCategory).

**Two-phase flow**:
- File selection (`handleFileChange()`): immediate — `parseCsv()` + `validateCsv()` + store `rules`; shows rule count/preview; NO LLM call
- Generate button (`handleGenerate()`): `serializeRules(rules)` + `hints` → `generateTestCases(combined)` from llmService; assigns TC-001, TC-002... IDs

**Filter**: `activeFilter` — 'All'|'Happy Path'|'Mandatory'|'Boundary'|'Conditional'|'Format'|'Calculation'.

**`RULE_TYPE_CHIP` colors**: Validation=red, Conditional=blue, Calculation=amber, Presentation=green.

**`PRIORITY_COLORS`**: High=red, Medium=amber, Low=slate.

**API**: `llmService.generateTestCases` → `/v1/llm/gemini` or `/v1/llm/claude`. No dedicated server route.

**LLM**: Gemini `gemini-2.5-flash` with full `responseSchema` for `testCases` array / Claude `claude-haiku-4-5-20251001`.

**Export**: 9-column CSV (Test Case ID, Field Section, Category, Description, Input Data, Expected Result, Priority, Preconditions, Test Steps) — directly importable into FieldExtractor's bundle mode. Also JSON export.

**Gotcha**: CSV validation runs on file selection, LLM only on explicit Generate. `hints` appended verbatim after serialized rules — additive, not filtering. No deduplication; overlapping rules generate overlapping test cases. `validateCsv()` requires only `['Field Name', 'Rule Type']`; additional columns passed through to LLM via `serializeRules()`.

---

## Shared Patterns Across All Components

| Pattern | Detail |
|---|---|
| Auth | `useAuth()` → `token` for Authorization header; `useSettings()` → `llmProvider` |
| LLM routing | All go through `services/llmService.ts` → `/v1/llm/gemini` or `/v1/llm/claude` **except GhostDraftGenerator** |
| PDF text | pdfjs-dist `getTextContent()` for text-mode; raw base64 passed to LLM for XPathExtractor |
| DOCX text | mammoth `convertToHtml()` when table structure matters; `extractRawText()` otherwise |
| Shared components | `FileUploader`, `ResultsTable`, `Loader`, `ToggleSwitch`, `LLMWarning` |
| Isolation rule | Fixing one accelerator must not modify shared code; create accelerator-specific copies if needed |
