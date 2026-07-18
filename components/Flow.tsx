/*
 * ============================================================
 * HOW TO ADD / UPDATE / REMOVE FLOWS
 * ============================================================
 *
 * ADDING A NEW FLOW
 * -----------------
 * 1. Add a FlowDef entry to the FLOWS array below.
 *    - id: unique string key
 *    - name / tagline / description: UI copy
 *    - color: one of 'indigo' | 'emerald' | 'violet' | 'amber' | 'rose'
 *    - inputs: files the user uploads before the flow starts
 *    - steps: ordered FlowStepDef array
 *
 * 2. Add execution logic to FLOW_RUNNERS:
 *      FLOW_RUNNERS['your-flow-id'] = {
 *        'step-id': async (shared) => {
 *          // read from `shared` (uploaded files + prior step outputs)
 *          // return Partial<SharedData> — keys merged into shared
 *        },
 *      };
 *
 * 3. Add result rendering to renderStepResult() — one case per step.
 *
 * UPDATING A STEP
 * ---------------
 * UI copy / flags → edit the FlowStepDef in FLOWS.
 * Execution logic  → edit the function in FLOW_RUNNERS.
 * These are deliberately separate so UI changes don't require touching logic.
 *
 * REMOVING A FLOW
 * ---------------
 * Delete its entry from FLOWS and its key from FLOW_RUNNERS. Done.
 *
 * MID-FLOW INPUTS (extra files needed mid-run)
 * --------------------------------------------
 * Add requiresMidInput to the step definition. The runner pauses before
 * that step and prompts the user. The uploaded file lands in shared[midInput.id].
 *
 * OPTIONAL STEPS
 * --------------
 * Add optional: true to the step definition. The runner pauses and asks
 * "Include this step?" before running it. User can skip it entirely.
 *
 * SHARED DATA CONTRACT
 * --------------------
 * SharedData is a plain Record<string,any> that grows across steps.
 * Initial input files are stored under their FlowInput.id. Step outputs
 * are merged in by their runner. Use descriptive keys to avoid collisions.
 * ============================================================
 */

import React, { useState, useRef } from 'react';
import * as pdfjs from 'pdfjs-dist';
import mammoth from 'mammoth';
import {
  extractBusinessRules,
  generateTestCases,
  generateDataMap,
  extractXPaths,
  performSemanticComparison,
} from '../services/llmService';
import { generateMockedXmlsFromTestCases } from '../services/mockedXmlsService';
import { SETTINGS_STORAGE_KEY } from '../contexts/SettingsContext';
import type { BusinessRule, TestCase, MockedXmlBundle, DataMapping, XPathMapping } from '../types';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

// ── Types ────────────────────────────────────────────────────────────────────

interface MidFlowInput { id: string; label: string; accept: string; hint: string; }
interface FlowInput    { id: string; label: string; accept: string; required: boolean; multiple?: boolean; hint?: string; }
interface FlowStepDef  {
  id: string; title: string; description: string;
  optional?: boolean;
  requiresMidInput?: MidFlowInput;
}
interface FlowDef {
  id: string; name: string; tagline: string; description: string;
  color: 'indigo' | 'emerald' | 'violet';
  inputs: FlowInput[];
  steps: FlowStepDef[];
}

type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'awaiting_decision' | 'awaiting_input';
type RunMode    = 'auto' | 'step';
interface StepState  { status: StepStatus; result?: any; error?: string; }
type SharedData      = Record<string, any>;
type StepRunner      = (shared: SharedData) => Promise<Partial<SharedData>>;

interface PauseState { stepIdx: number; reason: 'decision' | 'file' | 'proceed'; }

// ── Utilities ─────────────────────────────────────────────────────────────────

async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p);
    const content = await page.getTextContent();
    pages.push(content.items.map((it: any) => it.str).join(' '));
  }
  return pages.join('\n\n');
}

async function extractDocxText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return result.value;
}

async function extractDocxHtml(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer: buf });
  return result.value;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3));
}
function jaccardSim(a: Set<string>, b: Set<string>): number {
  const inter = [...a].filter(x => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union ? inter / union : 0;
}

function serializeRulesForTestGen(rules: BusinessRule[]): string {
  return rules.map(r => [
    `Field Name: ${r.fieldName}`,
    `Rule Type: ${r.ruleType}`,
    r.condition       ? `Condition: ${r.condition}`           : null,
    `Action/Formula: ${r.actionFormula}`,
    r.errorMessage    ? `Error Message: ${r.errorMessage}`    : null,
    `Priority: ${r.priority}`,
    r.pageReference   ? `Page Reference: ${r.pageReference}` : null,
  ].filter(Boolean).join('\n')).join('\n\n');
}

function serializeTestCasesForBundles(testCases: TestCase[]): string {
  return testCases.map((tc, i) => [
    `ID: TC-${String(i + 1).padStart(3, '0')}`,
    `Field/Section: ${tc.fieldSection}`,
    `Category: ${tc.category}`,
    `Description: ${tc.testDescription}`,
    `Input Data: ${tc.inputData}`,
    `Expected Result: ${tc.expectedResult}`,
    `Priority: ${tc.priority}`,
  ].join('\n')).join('\n\n');
}

function downloadText(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

function downloadTestCasesCsv(testCases: TestCase[]) {
  const headers = ['ID','Field Section','Category','Description','Input Data','Expected Result','Priority','Preconditions','Test Steps'];
  const rows    = testCases.map((tc, i) => [
    `TC-${String(i + 1).padStart(3, '0')}`, tc.fieldSection, tc.category,
    tc.testDescription, tc.inputData, tc.expectedResult, tc.priority, tc.preconditions, tc.testSteps,
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadText(csv, 'text/csv', 'test-cases.csv');
}

// ── Flow Definitions (pure data — add new flows here) ─────────────────────────

const FLOWS: FlowDef[] = [
  {
    id: 'template-testing',
    name: 'Template Testing Pipeline',
    tagline: 'Business rules → test cases → XML bundles',
    description: 'Extracts all business rules from a source document, generates a full test suite, then produces XML bundles that cover every test scenario — ready for validation.',
    color: 'indigo',
    inputs: [
      { id: 'sourceDocFile', label: 'Source Document (PDF or DOCX)', accept: '.pdf,.docx,.doc', required: true,  hint: 'Document containing your business rules, e.g. a form spec or BRD.' },
      { id: 'xsdFile',       label: 'XSD Schema File',               accept: '.xsd',            required: true,  hint: 'XML schema the generated bundles must conform to.' },
    ],
    steps: [
      { id: 'extract-rules',       title: 'Extract Business Rules',  description: 'AI reads the source document and identifies all validation, conditional, calculation, and presentation rules.' },
      { id: 'generate-test-cases', title: 'Generate Test Cases',     description: 'Converts every extracted rule into categorised test cases (happy path, boundary, conditional, format, calculation).' },
      { id: 'generate-xml-bundles',title: 'Generate XML Bundles',    description: 'Produces a minimal set of XML documents that together cover all test cases, strictly conforming to the XSD.' },
      {
        id: 'output-validator', title: 'Output Validator', optional: true,
        description: 'Upload the generated PDF output to validate it against the XML bundles and test cases.',
        requiresMidInput: {
          id: 'validatorPdfFile', label: 'Generated Output PDF', accept: '.pdf',
          hint: 'Upload the PDF produced by your document system. Flow pauses here — skip if you prefer to validate separately in the Output Validator tool.',
        },
      },
    ],
  },
  {
    id: 'document-mapping',
    name: 'Document Mapping Pipeline',
    tagline: 'DOCX template → XSD field map → XPath locations',
    description: 'Maps every variable field in a Word template to its XSD schema path, generates a sample XML, then locates each value\'s XPath position in the rendered PDF.',
    color: 'emerald',
    inputs: [
      { id: 'docxFile', label: 'Word Template (DOCX)', accept: '.docx,.doc', required: true, hint: 'The Word document containing placeholder fields or labelled data sections.' },
      { id: 'xsdFile',  label: 'XSD Schema File',      accept: '.xsd',       required: true, hint: 'XML schema the template fields map to.' },
    ],
    steps: [
      { id: 'data-mapping',    title: 'Data Mapping',    description: 'AI extracts every variable field from the Word template and maps each to its XPath in the XSD, generating a sample XML.' },
      {
        id: 'xpath-extraction', title: 'XPath Extraction',
        description: 'Using the sample XML from the previous step, locates each field value\'s XPath position within the rendered PDF.',
        requiresMidInput: {
          id: 'pdfFile', label: 'Rendered PDF Output', accept: '.pdf',
          hint: 'Upload the PDF rendered from the template. Flow pauses here to collect this file before running XPath extraction.',
        },
      },
    ],
  },
  {
    id: 'rationalize-compare',
    name: 'Rationalise & Compare',
    tagline: 'Multiple PDFs → similarity groups → semantic diff',
    description: 'Clusters PDFs by content similarity, automatically selects the most similar pair, then runs an AI semantic comparison to surface differences and paraphrases.',
    color: 'violet',
    inputs: [
      { id: 'pdfFiles', label: 'PDF Documents (2 or more)', accept: '.pdf', required: true, multiple: true, hint: 'Upload all PDFs to analyse. The flow groups them by similarity and compares the closest pair.' },
    ],
    steps: [
      { id: 'group-documents',    title: 'Group Documents',    description: 'Analyses word overlap between PDFs, clusters them into similarity groups, and selects the most similar pair for comparison.' },
      { id: 'semantic-comparison',title: 'Semantic Comparison',description: 'AI compares the selected pair, identifying both meaning differences and semantically-equivalent paraphrases.' },
    ],
  },
];

// ── Bundle generation helpers (Flow-specific, provider-aware) ─────────────────

function getFlowProvider(): 'gemini' | 'claude' | 'openai' {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
    if (s.llmProvider === 'claude') return 'claude';
    if (s.llmProvider === 'openai') return 'openai';
    return 'gemini';
  } catch { return 'gemini'; }
}

function getFlowToken(): string {
  try { return JSON.parse(localStorage.getItem('dih_auth') || '{}').token || ''; }
  catch { return ''; }
}

const BUNDLE_GEN_PROMPT = `
You are an expert XML data architect and QA engineer.
Given an XSD schema and a list of test cases, generate a minimal set of mocked XML documents that together cover ALL listed test cases. Every XML must strictly conform to the XSD.

Grouping strategy:
1. Happy-path tests for different fields may share one XML — set each field value to its valid input.
2. Conditional TRUE-branch and FALSE-branch tests must each have their own XML (field values differ between them).
3. Boundary/edge-case tests need separate XMLs when field values conflict with other groups.
4. Format tests (correct vs incorrect formatting) need separate XMLs when the format itself differs.
5. Aim for 3–8 XML bundles total; never create one bundle per test case unless truly unavoidable.
6. Every test case ID must appear in exactly one bundle's testCaseIds array — no test case left uncovered.

For each bundle populate XML fields with values that satisfy the "Input Data" of the assigned test cases.

Return ONLY a JSON object (no markdown, no explanation) with a single key "xmlBundles". Each entry must have:
- "testCaseIds": array of test case ID strings (e.g. ["TC-001", "TC-013"])
- "description": one concise sentence describing the scenario this XML covers
- "xmlContent": complete, valid, well-formed XML string conforming to the XSD
`;

async function generateBundlesForFlow(xsdContent: string, testCasesText: string): Promise<{ xmlBundles: MockedXmlBundle[] }> {
  const provider = getFlowProvider();
  if (provider !== 'openai') {
    return generateMockedXmlsFromTestCases(xsdContent, testCasesText) as Promise<{ xmlBundles: MockedXmlBundle[] }>;
  }
  // OpenAI path — direct call to the proxy with json_object response format
  const prompt = `${BUNDLE_GEN_PROMPT}\n\n--- XML SCHEMA (XSD) ---\n\n${xsdContent}\n\n--- TEST CASES ---\n\n${testCasesText}`;
  const resp = await fetch('/v1/llm/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getFlowToken()}` },
    body: JSON.stringify({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      accelerator: 'Template Testing Pipeline',
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message || (err as any)?.error || `OpenAI API error ${resp.status}`);
  }
  const data = await resp.json();
  const text: string = data?.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('OpenAI returned an empty response. Please try again.');
  const parsed = JSON.parse(text);
  if (!parsed.xmlBundles) throw new Error('OpenAI response missing xmlBundles key.');
  return parsed as { xmlBundles: MockedXmlBundle[] };
}

// ── Flow Runners (execution logic — add step logic here) ──────────────────────

const FLOW_RUNNERS: Record<string, Record<string, StepRunner>> = {
  'template-testing': {
    'extract-rules': async (shared) => {
      const file = shared.sourceDocFile as File;
      const isPdf = file.name.toLowerCase().endsWith('.pdf');
      const docText = isPdf ? await extractPdfText(file) : await extractDocxText(file);
      const { rules } = await extractBusinessRules(docText);
      return { businessRules: rules };
    },
    'generate-test-cases': async (shared) => {
      const rules    = shared.businessRules as BusinessRule[];
      const { testCases } = await generateTestCases(serializeRulesForTestGen(rules));
      return { testCases };
    },
    'generate-xml-bundles': async (shared) => {
      const xsdFile = shared.xsdFile as File;
      const xsdContent = await xsdFile.text();
      const testCases  = shared.testCases as TestCase[];
      const { xmlBundles } = await generateBundlesForFlow(xsdContent, serializeTestCasesForBundles(testCases));
      return { xmlBundles };
    },
    'output-validator': async (shared) => {
      // Handoff step: PDF is available in shared.validatorPdfFile
      // Deep integration requires PdfValidator props API — extend here when ready
      return { validatorReady: true };
    },
  },
  'document-mapping': {
    'data-mapping': async (shared) => {
      const docxFile   = shared.docxFile as File;
      const xsdFile    = shared.xsdFile  as File;
      const [docxHtml, xsdContent] = await Promise.all([extractDocxHtml(docxFile), xsdFile.text()]);
      const { mappings, generatedXml } = await generateDataMap(docxHtml, xsdContent, docxFile.name);
      return { dataMappings: mappings, generatedXml };
    },
    'xpath-extraction': async (shared) => {
      const pdfFile    = shared.pdfFile     as File;
      const xmlContent = shared.generatedXml as string;
      const pdfBase64  = await fileToBase64(pdfFile);
      const xpathMappings = await extractXPaths(pdfBase64, pdfFile.type, xmlContent, pdfFile.name);
      return { xpathMappings };
    },
  },
  'rationalize-compare': {
    'group-documents': async (shared) => {
      const files = shared.pdfFiles as File[];
      const docs  = await Promise.all(files.map(async f => ({ file: f, text: await extractPdfText(f) })));
      const bags  = docs.map(d => tokenize(d.text));
      let bestSim = -1; let pairA = 0; let pairB = Math.min(1, docs.length - 1);
      for (let i = 0; i < docs.length; i++) {
        for (let j = i + 1; j < docs.length; j++) {
          const sim = jaccardSim(bags[i], bags[j]);
          if (sim > bestSim) { bestSim = sim; pairA = i; pairB = j; }
        }
      }
      return { extractedDocs: docs, selectedPair: [pairA, pairB], pairSimilarity: Math.round(bestSim * 100) };
    },
    'semantic-comparison': async (shared) => {
      const docs = shared.extractedDocs as Array<{ file: File; text: string }>;
      const [a, b] = shared.selectedPair as [number, number];
      const comparisonResult = await performSemanticComparison(docs[a].text, docs[b].text);
      return { comparisonResult };
    },
  },
};

// ── Step Result Renderer ──────────────────────────────────────────────────────

function renderStepResult(flowId: string, stepId: string, _result: any, shared: SharedData): React.ReactNode {
  if (flowId === 'template-testing') {
    if (stepId === 'extract-rules') {
      const rules = (shared.businessRules ?? []) as BusinessRule[];
      const byType = rules.reduce<Record<string, number>>((acc, r) => { acc[r.ruleType] = (acc[r.ruleType] ?? 0) + 1; return acc; }, {});
      return (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{rules.length} rules extracted</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(byType).map(([type, count]) => (
              <span key={type} className="px-2 py-0.5 text-xs rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-medium">
                {type}: {count}
              </span>
            ))}
          </div>
          {rules.slice(0, 3).map((r, i) => (
            <div key={i} className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 rounded p-2">
              <span className="font-medium text-slate-700 dark:text-slate-300">{r.fieldName}</span> — {r.ruleType} — {r.actionFormula?.slice(0, 80)}{(r.actionFormula?.length ?? 0) > 80 ? '…' : ''}
            </div>
          ))}
          {rules.length > 3 && <p className="text-xs text-slate-400">…and {rules.length - 3} more</p>}
        </div>
      );
    }
    if (stepId === 'generate-test-cases') {
      const tcs = (shared.testCases ?? []) as TestCase[];
      const cats = tcs.reduce<Record<string, number>>((acc, t) => { acc[t.category] = (acc[t.category] ?? 0) + 1; return acc; }, {});
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{tcs.length} test cases generated</p>
            <button onClick={() => downloadTestCasesCsv(tcs)} className="text-xs px-2 py-1 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-900/60 transition-colors">
              Download CSV
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(cats).map(([cat, count]) => (
              <span key={cat} className="px-2 py-0.5 text-xs rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-medium">{cat}: {count}</span>
            ))}
          </div>
        </div>
      );
    }
    if (stepId === 'generate-xml-bundles') {
      const bundles = (shared.xmlBundles ?? []) as MockedXmlBundle[];
      return (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{bundles.length} XML bundles generated</p>
          <div className="space-y-1">
            {bundles.map((b, i) => (
              <div key={i} className="flex items-center justify-between text-xs bg-slate-50 dark:bg-slate-800 rounded p-2">
                <span className="text-slate-600 dark:text-slate-300 truncate mr-2">
                  <span className="font-medium">Bundle {i + 1}</span> — {b.testCaseIds.join(', ')} — {b.description.slice(0, 60)}{b.description.length > 60 ? '…' : ''}
                </span>
                <button onClick={() => downloadText(b.xmlContent, 'application/xml', `bundle-${i + 1}.xml`)} className="shrink-0 px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 transition-colors">
                  Download
                </button>
              </div>
            ))}
          </div>
        </div>
      );
    }
    if (stepId === 'output-validator') {
      const bundles = (shared.xmlBundles ?? []) as MockedXmlBundle[];
      return (
        <div className="space-y-2">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Download the XML bundles below, then open the <span className="font-semibold">Output Validator</span> tool and upload your PDF alongside them to complete validation.
          </p>
          <div className="flex flex-wrap gap-2">
            {bundles.map((b, i) => (
              <button key={i} onClick={() => downloadText(b.xmlContent, 'application/xml', `bundle-${i + 1}.xml`)} className="text-xs px-2 py-1 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 transition-colors">
                Bundle {i + 1}
              </button>
            ))}
          </div>
        </div>
      );
    }
  }

  if (flowId === 'document-mapping') {
    if (stepId === 'data-mapping') {
      const mappings = (shared.dataMappings ?? []) as DataMapping[];
      const mapped   = mappings.filter(m => m.xsdPath !== 'path not found').length;
      return (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{mappings.length} fields found, {mapped} mapped to XSD</p>
          {shared.generatedXml && (
            <button onClick={() => downloadText(shared.generatedXml, 'application/xml', 'generated.xml')} className="text-xs px-2 py-1 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 transition-colors">
              Download Sample XML
            </button>
          )}
        </div>
      );
    }
    if (stepId === 'xpath-extraction') {
      const mappings = (shared.xpathMappings ?? []) as XPathMapping[];
      const headers  = ['Value','XPath','Page','Type'];
      const rows     = mappings.map(m => [m.value, m.xpath, m.pageNumber, m.fieldType]);
      const csv      = [headers, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{mappings.length} XPath mappings found</p>
            <button onClick={() => downloadText(csv, 'text/csv', 'xpath-mappings.csv')} className="text-xs px-2 py-1 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 transition-colors">
              Download CSV
            </button>
          </div>
          {mappings.slice(0, 3).map((m, i) => (
            <div key={i} className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 rounded p-2">
              <span className="font-medium text-slate-700 dark:text-slate-300">{m.value}</span> → <code className="text-emerald-600 dark:text-emerald-400">{m.xpath}</code>
            </div>
          ))}
          {mappings.length > 3 && <p className="text-xs text-slate-400">…and {mappings.length - 3} more</p>}
        </div>
      );
    }
  }

  if (flowId === 'rationalize-compare') {
    if (stepId === 'group-documents') {
      const docs  = (shared.extractedDocs ?? []) as Array<{ file: File }>;
      const [a, b] = (shared.selectedPair ?? [0, 1]) as [number, number];
      return (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{docs.length} documents analysed</p>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Selected pair: <span className="font-medium">{docs[a]?.file.name}</span> and <span className="font-medium">{docs[b]?.file.name}</span>
            {' '}<span className="text-violet-600 dark:text-violet-400">({shared.pairSimilarity ?? 0}% similar)</span>
          </p>
        </div>
      );
    }
    if (stepId === 'semantic-comparison') {
      const results = (shared.comparisonResult ?? []) as Array<{ textA: string; textB: string; reason: string; kind: string }>;
      const diffs   = results.filter(r => r.kind === 'diff').length;
      const sames   = results.filter(r => r.kind === 'same').length;
      return (
        <div className="space-y-2">
          <div className="flex gap-3">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{diffs} differences</span>
            <span className="text-sm text-slate-500 dark:text-slate-400">{sames} paraphrases</span>
          </div>
          {results.slice(0, 3).map((r, i) => (
            <div key={i} className={`text-xs rounded p-2 ${r.kind === 'diff' ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300' : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'}`}>
              <span className="font-semibold">{r.kind === 'diff' ? 'Difference' : 'Paraphrase'}:</span> {r.textA?.slice(0, 80) || r.textB?.slice(0, 80)}{((r.textA ?? r.textB)?.length ?? 0) > 80 ? '…' : ''}
            </div>
          ))}
          {results.length > 3 && <p className="text-xs text-slate-400">…and {results.length - 3} more</p>}
        </div>
      );
    }
  }

  return null;
}

// ── Color Maps ────────────────────────────────────────────────────────────────

const COLOR = {
  indigo: {
    border:  'border-indigo-500',
    badge:   'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
    btn:     'bg-indigo-600 hover:bg-indigo-700 text-white',
    dot:     'bg-indigo-500',
    ring:    'border-indigo-500',
    text:    'text-indigo-600 dark:text-indigo-400',
  },
  emerald: {
    border:  'border-emerald-500',
    badge:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    btn:     'bg-emerald-600 hover:bg-emerald-700 text-white',
    dot:     'bg-emerald-500',
    ring:    'border-emerald-500',
    text:    'text-emerald-600 dark:text-emerald-400',
  },
  violet: {
    border:  'border-violet-500',
    badge:   'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    btn:     'bg-violet-600 hover:bg-violet-700 text-white',
    dot:     'bg-violet-500',
    ring:    'border-violet-500',
    text:    'text-violet-600 dark:text-violet-400',
  },
} as const;

// ── FlowSelector ──────────────────────────────────────────────────────────────

const FlowSelector: React.FC<{ onSelect: (flow: FlowDef) => void }> = ({ onSelect }) => (
  <div>
    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">Flows</h2>
    <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">
      Pre-built pipelines that chain multiple accelerators together — upload once, get all outputs automatically.
    </p>
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
      {FLOWS.map(flow => {
        const c = COLOR[flow.color];
        return (
          <div key={flow.id} className={`bg-white dark:bg-slate-800 rounded-xl border-l-4 ${c.border} shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col`}>
            <div className="flex items-start justify-between mb-3">
              <h3 className="font-semibold text-slate-900 dark:text-white leading-snug">{flow.name}</h3>
              <span className={`shrink-0 ml-2 text-xs px-2 py-0.5 rounded-full font-medium ${c.badge}`}>
                {flow.steps.length} steps
              </span>
            </div>
            <p className={`text-xs font-medium mb-2 ${c.text}`}>{flow.tagline}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 flex-1">{flow.description}</p>
            <ol className="space-y-1 mb-5">
              {flow.steps.map((step, i) => (
                <li key={step.id} className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0 ${c.dot}`}>{i + 1}</span>
                  {step.title}{step.optional ? ' (optional)' : ''}
                </li>
              ))}
            </ol>
            <button onClick={() => onSelect(flow)} className={`w-full py-2 rounded-lg text-sm font-semibold transition-colors ${c.btn}`}>
              Start Flow →
            </button>
          </div>
        );
      })}
    </div>
  </div>
);

// ── Status Icons ──────────────────────────────────────────────────────────────

const IconPending = () => <div className="w-6 h-6 rounded-full border-2 border-slate-300 dark:border-slate-600" />;
const IconRunning = () => (
  <svg className="w-6 h-6 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);
const IconDone = () => (
  <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
    <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  </div>
);
const IconError = () => (
  <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center">
    <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  </div>
);
const IconPause = () => (
  <div className="w-6 h-6 rounded-full bg-amber-400 flex items-center justify-center">
    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
      <rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  </div>
);
const IconSkipped = () => (
  <div className="w-6 h-6 rounded-full bg-slate-300 dark:bg-slate-600 flex items-center justify-center">
    <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l9 6-9 6V8zm9 0l9 6-9 6V8z" />
    </svg>
  </div>
);

function stepIcon(status: StepStatus) {
  if (status === 'done')             return <IconDone />;
  if (status === 'running')          return <IconRunning />;
  if (status === 'error')            return <IconError />;
  if (status === 'awaiting_input')   return <IconPause />;
  if (status === 'awaiting_decision')return <IconPause />;
  if (status === 'skipped')          return <IconSkipped />;
  return <IconPending />;
}

// ── Single-file input helper ──────────────────────────────────────────────────

const FileInputRow: React.FC<{
  label: string; accept: string; multiple?: boolean; required?: boolean;
  hint?: string; value: File | File[] | null;
  onChange: (f: File | File[] | null) => void;
}> = ({ label, accept, multiple, required, hint, value, onChange }) => {
  const id = `fi-${label.replace(/\s/g, '-')}`;
  const name = Array.isArray(value) ? `${value.length} file${value.length !== 1 ? 's' : ''} selected` : value?.name ?? '';
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {hint && <p className="text-xs text-slate-400 dark:text-slate-500 mb-1.5">{hint}</p>}
      <label htmlFor={id} className="flex items-center gap-3 cursor-pointer border border-dashed border-slate-300 dark:border-slate-600 rounded-lg px-4 py-3 hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors">
        <svg className="w-5 h-5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
        </svg>
        <span className="text-sm text-slate-500 dark:text-slate-400 truncate">
          {name || <span className="text-slate-400">Click to select{multiple ? ' files' : ' a file'}</span>}
        </span>
        {(Array.isArray(value) ? value.length > 0 : !!value) && (
          <button type="button" onClick={e => { e.preventDefault(); onChange(null); }} className="ml-auto text-slate-400 hover:text-red-500 shrink-0">✕</button>
        )}
      </label>
      <input id={id} type="file" accept={accept} multiple={multiple} className="sr-only"
        onChange={e => {
          if (!e.target.files?.length) return;
          onChange(multiple ? Array.from(e.target.files) : e.target.files[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
};

// ── FlowRunner ────────────────────────────────────────────────────────────────

const FlowRunner: React.FC<{ flow: FlowDef; onBack: () => void }> = ({ flow, onBack }) => {
  const c = COLOR[flow.color];

  // Pre-start state
  const [started, setStarted]   = useState(false);
  const [mode, setMode]         = useState<RunMode>('auto');
  const [inputFiles, setInputFiles] = useState<Record<string, File | File[] | null>>({});
  const [inputErr, setInputErr] = useState('');

  // Execution state
  const [stepStates, setStepStates]   = useState<Record<string, StepState>>({});
  const [flowDone, setFlowDone]       = useState(false);
  const [pauseState, setPauseState]   = useState<PauseState | null>(null);
  const [midFile, setMidFile]         = useState<File | null>(null);
  const [optDecision, setOptDecision] = useState<Record<string, 'include' | 'skip'>>({});
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});

  // Refs for latest values accessible inside async loops
  const sharedRef      = useRef<SharedData>({});
  const modeRef        = useRef<RunMode>('auto');
  const optDecisionRef = useRef<Record<string, 'include' | 'skip'>>({});
  modeRef.current        = mode;
  optDecisionRef.current = optDecision;

  function updateStep(stepId: string, patch: Partial<StepState>) {
    setStepStates(prev => ({ ...prev, [stepId]: { ...(prev[stepId] ?? { status: 'pending' }), ...patch } }));
  }

  async function executeFrom(startIdx: number) {
    const sh = sharedRef.current;
    let idx  = startIdx;

    while (idx < flow.steps.length) {
      const step = flow.steps[idx];

      // Optional: need decision
      if (step.optional && !optDecisionRef.current[step.id]) {
        updateStep(step.id, { status: 'awaiting_decision' });
        setPauseState({ stepIdx: idx, reason: 'decision' });
        return;
      }
      // Optional: skip
      if (step.optional && optDecisionRef.current[step.id] === 'skip') {
        updateStep(step.id, { status: 'skipped' });
        idx++; continue;
      }
      // Mid-flow file needed
      if (step.requiresMidInput && !sharedRef.current[step.requiresMidInput.id]) {
        updateStep(step.id, { status: 'awaiting_input' });
        setPauseState({ stepIdx: idx, reason: 'file' });
        return;
      }

      // Run the step
      updateStep(step.id, { status: 'running' });
      setPauseState(null);
      try {
        const runner = FLOW_RUNNERS[flow.id]?.[step.id];
        if (!runner) throw new Error(`No runner defined for step "${step.id}"`);
        const result  = await runner(sharedRef.current);
        sharedRef.current = { ...sharedRef.current, ...result };
        updateStep(step.id, { status: 'done', result });
        setExpandedSteps(prev => ({ ...prev, [step.id]: true }));
      } catch (e: any) {
        updateStep(step.id, { status: 'error', error: e.message ?? 'Unknown error' });
        return;
      }

      // Step-by-step: pause after each step (except last)
      if (modeRef.current === 'step' && idx < flow.steps.length - 1) {
        setPauseState({ stepIdx: idx, reason: 'proceed' });
        return;
      }

      idx++;
    }
    setFlowDone(true);
  }

  function handleStart() {
    for (const inp of flow.inputs) {
      if (inp.required && !inputFiles[inp.id]) { setInputErr(`Please provide: ${inp.label}`); return; }
    }
    setInputErr('');
    const initial: SharedData = {};
    for (const inp of flow.inputs) { if (inputFiles[inp.id]) initial[inp.id] = inputFiles[inp.id]; }
    sharedRef.current = initial;
    setStarted(true);
    executeFrom(0);
  }

  function handleInclude(stepIdx: number) {
    const step = flow.steps[stepIdx];
    optDecisionRef.current = { ...optDecisionRef.current, [step.id]: 'include' };
    setOptDecision({ ...optDecisionRef.current });
    setPauseState(null);
    executeFrom(stepIdx);
  }
  function handleSkip(stepIdx: number) {
    const step = flow.steps[stepIdx];
    optDecisionRef.current = { ...optDecisionRef.current, [step.id]: 'skip' };
    setOptDecision({ ...optDecisionRef.current });
    setPauseState(null);
    executeFrom(stepIdx);
  }
  function handleMidInputSubmit(stepIdx: number) {
    if (!midFile) return;
    const step = flow.steps[stepIdx];
    sharedRef.current = { ...sharedRef.current, [step.requiresMidInput!.id]: midFile };
    setMidFile(null);
    setPauseState(null);
    executeFrom(stepIdx);
  }
  function handleProceed(stepIdx: number) {
    setPauseState(null);
    executeFrom(stepIdx + 1);
  }

  const isRunning = Object.values(stepStates).some((s: StepState) => s.status === 'running');

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
          All Flows
        </button>
        <span className="text-slate-300 dark:text-slate-600">/</span>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">{flow.name}</h2>
      </div>

      {/* Warning banner — shown once flow has started */}
      {started && (
        <div className="mb-5 flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-4 py-3">
          <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" clipRule="evenodd" />
          </svg>
          <p className="text-sm text-amber-700 dark:text-amber-300">
            <span className="font-semibold">Do not refresh this page.</span> All intermediate results are held in browser memory — a page refresh will abort the flow and all progress will be lost. Download any results you need before closing this tab.
          </p>
        </div>
      )}

      {/* Pre-start: inputs + mode */}
      {!started && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 mb-6 space-y-5">
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-white mb-1">Configure &amp; Start</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">{flow.description}</p>
          </div>

          {/* Run mode */}
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Run mode</p>
            <div className="flex gap-3">
              {(['auto', 'step'] as RunMode[]).map(m => (
                <button key={m} onClick={() => setMode(m)}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ${mode === m ? `${c.btn} border-transparent` : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
                  {m === 'auto' ? '⚡ Automated' : '🔍 Step by Step'}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">
              {mode === 'auto' ? 'Each step starts automatically as soon as the previous one finishes.' : 'Flow pauses after each step so you can review before proceeding.'}
            </p>
          </div>

          {/* Initial file inputs */}
          <div className="space-y-4">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Required files</p>
            {flow.inputs.map(inp => (
              <FileInputRow key={inp.id} label={inp.label} accept={inp.accept} multiple={inp.multiple}
                required={inp.required} hint={inp.hint} value={inputFiles[inp.id] ?? null}
                onChange={f => setInputFiles(prev => ({ ...prev, [inp.id]: f as any }))}
              />
            ))}
          </div>

          {inputErr && <p className="text-sm text-red-500">{inputErr}</p>}

          <button onClick={handleStart} className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-colors ${c.btn}`}>
            Launch Flow →
          </button>
        </div>
      )}

      {/* Steps timeline */}
      {started && (
        <div className="space-y-0">
          {flow.steps.map((step, idx) => {
            const state   = stepStates[step.id] ?? { status: 'pending' };
            const isLast  = idx === flow.steps.length - 1;
            const expanded = expandedSteps[step.id] ?? false;

            return (
              <div key={step.id} className="flex gap-4">
                {/* Left: icon + connector line */}
                <div className="flex flex-col items-center">
                  <div className="mt-4">{stepIcon(state.status)}</div>
                  {!isLast && <div className={`w-0.5 flex-1 mt-1 mb-0 ${state.status === 'done' ? 'bg-green-300 dark:bg-green-700' : 'bg-slate-200 dark:bg-slate-700'}`} />}
                </div>

                {/* Right: content */}
                <div className={`flex-1 pb-5 ${isLast ? '' : ''}`}>
                  <div className="flex items-start justify-between mt-3.5">
                    <div>
                      <p className={`text-sm font-semibold ${state.status === 'pending' || state.status === 'skipped' ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-white'}`}>
                        {step.title}
                        {step.optional && <span className="ml-2 text-xs font-normal text-slate-400">(optional)</span>}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{step.description}</p>
                    </div>
                    {state.status === 'done' && (
                      <button onClick={() => setExpandedSteps(prev => ({ ...prev, [step.id]: !prev[step.id] }))}
                        className="ml-3 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 shrink-0">
                        {expanded ? 'Hide' : 'Show'} result
                      </button>
                    )}
                  </div>

                  {/* Error */}
                  {state.status === 'error' && (
                    <div className="mt-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                      {state.error}
                    </div>
                  )}

                  {/* Result (expandable) */}
                  {state.status === 'done' && expanded && (
                    <div className="mt-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg p-4">
                      {renderStepResult(flow.id, step.id, state.result, sharedRef.current)}
                    </div>
                  )}

                  {/* Decision prompt (optional step) */}
                  {state.status === 'awaiting_decision' && pauseState?.stepIdx === idx && (
                    <div className="mt-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4">
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-3">Include this optional step?</p>
                      {step.requiresMidInput && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
                          You will be asked to upload: <span className="font-medium">{step.requiresMidInput.label}</span>
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button onClick={() => handleInclude(idx)} className="px-4 py-1.5 text-sm font-medium bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors">Include</button>
                        <button onClick={() => handleSkip(idx)} className="px-4 py-1.5 text-sm font-medium border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Skip</button>
                      </div>
                    </div>
                  )}

                  {/* Mid-flow file upload */}
                  {state.status === 'awaiting_input' && pauseState?.stepIdx === idx && step.requiresMidInput && (
                    <div className="mt-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4 space-y-3">
                      <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Additional file required to continue</p>
                      <FileInputRow label={step.requiresMidInput.label} accept={step.requiresMidInput.accept}
                        hint={step.requiresMidInput.hint} value={midFile}
                        onChange={f => setMidFile(f as File)}
                      />
                      <button onClick={() => handleMidInputSubmit(idx)} disabled={!midFile}
                        className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${midFile ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed'}`}>
                        Continue Flow →
                      </button>
                    </div>
                  )}

                  {/* Proceed button (step-by-step mode) */}
                  {state.status === 'done' && pauseState?.stepIdx === idx && pauseState.reason === 'proceed' && (
                    <div className="mt-3">
                      <button onClick={() => handleProceed(idx)} className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-colors ${c.btn}`}>
                        Proceed to {flow.steps[idx + 1]?.title ?? 'Finish'} →
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Flow complete banner */}
      {flowDone && (
        <div className="mt-4 flex items-center gap-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl px-5 py-4">
          <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-green-800 dark:text-green-300">Flow complete!</p>
            <p className="text-xs text-green-600 dark:text-green-400">All steps finished. Download your results from each step above before leaving this page.</p>
          </div>
          <button onClick={onBack} className="ml-auto text-sm text-green-700 dark:text-green-300 hover:underline shrink-0">Run another flow</button>
        </div>
      )}
    </div>
  );
};

// ── Main Flow Screen ──────────────────────────────────────────────────────────

const Flow: React.FC = () => {
  const [activeFlow, setActiveFlow] = useState<FlowDef | null>(null);
  return activeFlow
    ? <FlowRunner flow={activeFlow} onBack={() => setActiveFlow(null)} />
    : <FlowSelector onSelect={setActiveFlow} />;
};

export default Flow;
