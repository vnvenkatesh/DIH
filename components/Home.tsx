
import React from 'react';
import { Squares2X2Icon } from './icons/Squares2X2Icon';
import { ArrowsRightLeftIcon } from './icons/ArrowsRightLeftIcon';
import { LinkIcon } from './icons/LinkIcon';
import { CodeBracketIcon } from './icons/CodeBracketIcon';
import { DocumentTextIcon } from './icons/DocumentTextIcon';
import { DevicePhoneMobileIcon } from './icons/DevicePhoneMobileIcon';
import { AccessibilityIcon } from './icons/AccessibilityIcon';
import { ClipboardRulesIcon } from './icons/ClipboardRulesIcon';
import TestCaseIcon from './icons/TestCaseIcon';

const EyeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

interface HomeProps {
  onNavigate: (tool: string) => void;
}

const accelerators = [
  {
    id: 'rationalizer',
    Icon: Squares2X2Icon,
    name: 'Rationalizer',
    tagline: 'Cut through document redundancy',
    description:
      'Upload a collection of PDFs and let AI automatically cluster duplicates and near-duplicates. What used to take days of manual side-by-side review is reduced to a single click.',
    benefit: 'Eliminate redundant templates before they reach production',
    accent: { bg: 'bg-indigo-50 dark:bg-indigo-900/20', icon: 'bg-indigo-100 dark:bg-indigo-800/60 text-indigo-600 dark:text-indigo-300', border: 'border-indigo-100 dark:border-indigo-800/50', tag: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' },
  },
  {
    id: 'pdfCompare',
    Icon: ArrowsRightLeftIcon,
    name: 'PDF AI Compare',
    tagline: 'See what changed in meaning',
    description:
      'Compare two PDFs side-by-side with paragraph-level exact diffs or AI-powered semantic analysis that catches logic changes even when wording differs. No more missed intent shifts in 40-page policy documents.',
    benefit: 'Catch every change — textual or meaning-level',
    accent: { bg: 'bg-sky-50 dark:bg-sky-900/20', icon: 'bg-sky-100 dark:bg-sky-800/60 text-sky-600 dark:text-sky-300', border: 'border-sky-100 dark:border-sky-800/50', tag: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300' },
  },
  {
    id: 'pdfVisualCompare',
    Icon: EyeIcon,
    name: 'PDF Visual Compare',
    tagline: 'Pixel-precise visual diff, no AI',
    description:
      'Upload two PDFs and get a page-by-page visual diff with colour-coded highlights — blue for added, red for removed, orange for modified. Hover any highlight to see the exact text. Strip out timestamps or page numbers before diffing using the exclusion panel.',
    benefit: 'Validate changes without sending any content to an AI service',
    accent: { bg: 'bg-teal-50 dark:bg-teal-900/20', icon: 'bg-teal-100 dark:bg-teal-800/60 text-teal-600 dark:text-teal-300', border: 'border-teal-100 dark:border-teal-800/50', tag: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300' },
  },
  {
    id: 'dataMappingGenerator',
    Icon: LinkIcon,
    name: 'Data Mapping Generator',
    tagline: 'From Word doc to XSD mapping in seconds',
    description:
      'Upload a Word document and an XSD schema — AI identifies every data field and maps it to the correct schema path, then generates a ready-to-use XML output populated with sample values.',
    benefit: 'Eliminate weeks of manual field-mapping spreadsheets',
    accent: { bg: 'bg-violet-50 dark:bg-violet-900/20', icon: 'bg-violet-100 dark:bg-violet-800/60 text-violet-600 dark:text-violet-300', border: 'border-violet-100 dark:border-violet-800/50', tag: 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300' },
  },
  {
    id: 'xpathExtractor',
    Icon: CodeBracketIcon,
    name: 'XPath Extractor',
    tagline: 'Bridge PDF data to XML structure',
    description:
      'Point at a PDF and an XML template and let AI extract every data value and map it to the right XPath location. Turns a multi-day data-extraction task into a one-step operation.',
    benefit: 'Accelerate XML data population for CCM templates',
    accent: { bg: 'bg-cyan-50 dark:bg-cyan-900/20', icon: 'bg-cyan-100 dark:bg-cyan-800/60 text-cyan-600 dark:text-cyan-300', border: 'border-cyan-100 dark:border-cyan-800/50', tag: 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300' },
  },
  {
    id: 'syntheticDataGenerator',
    Icon: DocumentTextIcon,
    name: 'Synthetic Data Generation',
    tagline: 'Realistic test data from any XSD',
    description:
      'Provide an XSD schema and AI generates contextually accurate synthetic data. Optionally upload a Test Cases CSV — AI then groups the test cases and produces a set of valid XML bundles, each tagged with the test case IDs it covers.',
    benefit: 'Safe, schema-valid test data aligned to your test suite',
    accent: { bg: 'bg-emerald-50 dark:bg-emerald-900/20', icon: 'bg-emerald-100 dark:bg-emerald-800/60 text-emerald-600 dark:text-emerald-300', border: 'border-emerald-100 dark:border-emerald-800/50', tag: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' },
  },
  {
    id: 'layoutRecommendation',
    Icon: DevicePhoneMobileIcon,
    name: 'Layout Recommendation',
    tagline: 'One document, every channel',
    description:
      'Upload a PDF or Word document and receive AI-optimised versions ready for email and WhatsApp — automatically reformatted for each channel\'s length, structure, and tone requirements.',
    benefit: 'Remove the manual effort of omni-channel content adaptation',
    accent: { bg: 'bg-amber-50 dark:bg-amber-900/20', icon: 'bg-amber-100 dark:bg-amber-800/60 text-amber-600 dark:text-amber-300', border: 'border-amber-100 dark:border-amber-800/50', tag: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' },
  },
  {
    id: 'accessibilityScorer',
    Icon: AccessibilityIcon,
    name: 'Accessibility Check',
    tagline: 'Ensure every customer can read it',
    description:
      'Upload a PDF and receive a detailed compliance audit across WCAG 2.1, PDF/UA (ISO 14289), Section 508, and EN 301 549. Get a scored report with severity-ranked issues and actionable remediation steps.',
    benefit: 'Meet legal accessibility obligations and serve every customer',
    accent: { bg: 'bg-rose-50 dark:bg-rose-900/20', icon: 'bg-rose-100 dark:bg-rose-800/60 text-rose-600 dark:text-rose-300', border: 'border-rose-100 dark:border-rose-800/50', tag: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300' },
  },
  {
    id: 'businessRulesExtractor',
    Icon: ClipboardRulesIcon,
    name: 'Business Rules',
    tagline: 'Every rule, automatically surfaced',
    description:
      'Upload any requirements document or BRD and AI extracts every validation, conditional, calculation, and presentation rule — including implicit rules hidden in placeholders, date arithmetic, and reviewer comments. Exports to CSV and JSON.',
    benefit: 'Capture rules that would otherwise be missed in manual review',
    accent: { bg: 'bg-fuchsia-50 dark:bg-fuchsia-900/20', icon: 'bg-fuchsia-100 dark:bg-fuchsia-800/60 text-fuchsia-600 dark:text-fuchsia-300', border: 'border-fuchsia-100 dark:border-fuchsia-800/50', tag: 'bg-fuchsia-100 dark:bg-fuchsia-900/40 text-fuchsia-700 dark:text-fuchsia-300' },
  },
  {
    id: 'testCaseGenerator',
    Icon: TestCaseIcon,
    name: 'Test Case Generator',
    tagline: 'Rules in, full test suite out',
    description:
      'Upload a Business Rules CSV and receive a complete test suite covering all six categories — happy path, mandatory violations, boundary values, conditional branches, format violations, and calculation checks. Add domain hints to generate additional edge-case tests.',
    benefit: 'Cut QA authoring effort by 60–70% on typical implementations',
    accent: { bg: 'bg-lime-50 dark:bg-lime-900/20', icon: 'bg-lime-100 dark:bg-lime-800/60 text-lime-600 dark:text-lime-300', border: 'border-lime-100 dark:border-lime-800/50', tag: 'bg-lime-100 dark:bg-lime-900/40 text-lime-700 dark:text-lime-300' },
  },
  {
    id: 'ghostDraftGenerator',
    Icon: ({ className }: { className?: string }) => (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 2C8.13 2 5 5.13 5 9v8l2-2 2 2 2-2 2 2 2-2 2 2V9c0-3.87-3.13-7-7-7z" />
        <circle cx="9" cy="9" r="1" fill="currentColor" stroke="none" />
        <circle cx="15" cy="9" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
    name: 'GhostDraft Generator',
    tagline: 'Word doc to .gd in one click',
    description:
      'Upload a Word document, XPath mapping CSV (from XPath Extractor), and XSD schema to generate a GhostDraft Native (.gd) document with embedded fill point bindings plus a pre-populated sample XML ready for immediate testing in GhostDraft Studio.',
    benefit: 'Eliminates hours of manual variable tagging and Model Library wiring',
    accent: { bg: 'bg-indigo-50 dark:bg-indigo-900/20', icon: 'bg-indigo-100 dark:bg-indigo-800/60 text-indigo-600 dark:text-indigo-300', border: 'border-indigo-100 dark:border-indigo-800/50', tag: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' },
  },
];

const securityPoints = [
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" />
      </svg>
    ),
    title: 'Processed in your browser',
    body: 'All document parsing and text extraction happens locally in your browser. Files are never routed through an intermediate server.',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    ),
    title: 'Direct API calls only',
    body: 'Document content is sent directly from your browser to Google Gemini. No Deloitte-managed server stores, logs, or inspects the payload.',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
      </svg>
    ),
    title: 'Your API key, your control',
    body: 'The Gemini API key is stored only in your browser\'s local storage and is never transmitted to any server other than Google\'s own API endpoint.',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
    ),
    title: 'No data retention',
    body: 'Once your session ends, no document content, results, or metadata persist anywhere. Each session starts completely fresh.',
  },
];

const Home: React.FC<HomeProps> = ({ onNavigate }) => {
  return (
    <div className="max-w-5xl mx-auto space-y-12 pb-12">

      {/* ── Hero ── */}
      <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-indigo-700 via-indigo-600 to-slate-700 px-8 py-12 text-white shadow-xl">
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: 'radial-gradient(circle at 70% 30%, white 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
        <div className="relative max-w-2xl">
          <span className="inline-block mb-4 px-3 py-1 text-xs font-semibold tracking-widest uppercase bg-white/20 rounded-full">
            AI-Powered &amp; AI-Free · CCM Accelerators
          </span>
          <h2 className="text-3xl md:text-4xl font-extrabold leading-tight mb-4">
            Accelerate Every Stage of Your CCM Implementation
          </h2>
          <p className="text-indigo-100 text-base leading-relaxed mb-8">
            A suite of AI-powered tools purpose-built for Customer Communication Management
            projects. Cut manual effort, reduce delivery risk, and keep every byte of client
            content secure throughout the engagement.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => onNavigate('rationalizer')}
              className="px-5 py-2.5 bg-white text-indigo-700 font-bold text-sm rounded-lg hover:bg-indigo-50 transition-colors shadow"
            >
              Get Started
            </button>
            <button
              onClick={() => onNavigate('apiDocs')}
              className="px-5 py-2.5 bg-white/15 border border-white/30 text-white font-semibold text-sm rounded-lg hover:bg-white/25 transition-colors"
            >
              View API Docs
            </button>
          </div>
        </div>
      </div>

      {/* ── Impact metrics ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { value: '10', label: 'Accelerators', sub: '9 AI-powered, 1 AI-free' },
          { value: '80%', label: 'Less manual effort', sub: 'on document tasks' },
          { value: '0', label: 'Data retained', sub: 'after each session' },
          { value: '100%', label: 'Browser-side', sub: 'document processing' },
        ].map(({ value, label, sub }) => (
          <div key={label} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 px-5 py-5 text-center shadow-sm">
            <p className="text-3xl font-extrabold text-indigo-600 dark:text-indigo-400 leading-none">{value}</p>
            <p className="mt-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* ── Accelerators grid ── */}
      <div>
        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">The Accelerators</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          Each tool targets a specific bottleneck in the CCM delivery lifecycle.
        </p>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {accelerators.map(({ id, Icon, name, tagline, description, benefit, accent }) => (
            <div
              key={id}
              className={`group relative flex flex-col rounded-xl border ${accent.border} ${accent.bg} p-5 shadow-sm hover:shadow-md transition-all duration-200`}
            >
              <div className={`w-10 h-10 rounded-lg ${accent.icon} flex items-center justify-center mb-4 flex-shrink-0`}>
                <Icon className="w-5 h-5" />
              </div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">{tagline}</p>
              <h4 className="text-base font-bold text-slate-900 dark:text-white mb-2">{name}</h4>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed flex-1">{description}</p>
              <div className={`mt-4 flex items-start gap-2 rounded-lg px-3 py-2 ${accent.tag}`}>
                <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                </svg>
                <p className="text-xs font-medium leading-snug">{benefit}</p>
              </div>
              <button
                onClick={() => onNavigate(id)}
                className="mt-4 w-full py-2 text-xs font-semibold rounded-lg border border-current opacity-60 hover:opacity-100 transition-opacity text-slate-600 dark:text-slate-300"
              >
                Open Tool →
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Connected workflow callout ── */}
      <div className="rounded-2xl border border-indigo-100 dark:border-indigo-800/50 bg-indigo-50 dark:bg-indigo-900/20 px-7 py-6">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-5 h-5 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
          <h3 className="text-base font-bold text-indigo-900 dark:text-indigo-200">Connected Workflows</h3>
        </div>
        <p className="text-sm text-indigo-700 dark:text-indigo-300 mb-4 max-w-2xl">
          Multiple accelerators are designed to chain — the output of one becomes the input of the next.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          {[
            {
              steps: ['Business Rules', '→', 'Test Case Generator', '→', 'Synthetic Data'],
              label: 'Requirements → Test Coverage',
            },
            {
              steps: ['Data Mapping Generator', '→', 'XPath Extractor', '→', 'GhostDraft Generator'],
              label: 'Field Mapping → GhostDraft Document',
            },
            {
              steps: ['Data Mapping Generator', '→', 'XPath Extractor'],
              label: 'Schema Mapping Pipeline',
            },
          ].map(({ steps, label }) => (
            <div key={label} className="flex-1 bg-white dark:bg-slate-800 rounded-xl border border-indigo-100 dark:border-indigo-800/60 px-4 py-3 shadow-sm">
              <p className="text-xs text-indigo-500 dark:text-indigo-400 font-semibold uppercase tracking-wide mb-2">{label}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {steps.map((s, i) => (
                  s === '→'
                    ? <span key={i} className="text-slate-400 font-bold text-sm">→</span>
                    : <span key={i} className="text-xs font-semibold bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full">{s}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Security & trust ── */}
      <div className="rounded-2xl bg-slate-900 dark:bg-slate-950 text-white px-8 py-10">
        <div className="flex items-center gap-3 mb-2">
          <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          <h3 className="text-xl font-bold">Built with Client Security in Mind</h3>
        </div>
        <p className="text-slate-400 text-sm mb-8 max-w-2xl">
          Handling client documents on an engagement demands the highest standards of
          confidentiality. This platform is architected so that no client content ever
          passes through or rests on any Deloitte-managed infrastructure.
        </p>
        <div className="grid md:grid-cols-2 gap-5">
          {securityPoints.map(({ icon, title, body }) => (
            <div key={title} className="flex gap-4">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center flex-shrink-0">
                {icon}
              </div>
              <div>
                <p className="text-sm font-semibold text-white mb-1">{title}</p>
                <p className="text-xs text-slate-400 leading-relaxed">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── How it fits into CCM delivery ── */}
      <div>
        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">Where This Fits in CCM Delivery</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          These tools address the highest-friction points across a typical CCM implementation lifecycle.
        </p>
        <div className="relative">
          <div className="absolute left-5 top-5 bottom-5 w-px bg-indigo-200 dark:bg-indigo-800 hidden md:block" />
          <div className="space-y-4">
            {[
              { phase: 'Discovery', tools: ['Rationalizer'], detail: 'Rapidly assess and rationalise an existing template library. Identify redundant documents before migrating them to the new platform.' },
              { phase: 'Requirements Analysis', tools: ['Business Rules'], detail: 'Extract every business rule from requirements documents, BRDs, and client communications — including implicit rules hidden in placeholders, date arithmetic, and reviewer comments. Output a structured, reviewable rule set ready for the build team.' },
              { phase: 'Design & Mapping', tools: ['Data Mapping Generator', 'XPath Extractor'], detail: 'Automate the tedious field-mapping and XPath derivation work that typically consumes weeks of a technical consultant\'s time.' },
              { phase: 'Build & Test', tools: ['Synthetic Data Generation', 'Test Case Generator', 'GhostDraft Generator'], detail: 'Derive a complete test suite from extracted business rules. Feed that test cases CSV into Synthetic Data Generation alongside your XSD — AI produces grouped XML bundles tagged with test case IDs. Use GhostDraft Generator to turn your Word template, XPath mapping CSV, and XSD into a ready-to-use .gd document with embedded fill point bindings and a sample XML for immediate Studio testing.' },
              { phase: 'QA & Review', tools: ['PDF AI Compare', 'PDF Visual Compare'], detail: 'Validate every document version change between iterations. Use Visual Compare for a fast, AI-free structural and pixel diff; switch to AI Compare when you need to catch intent shifts that wording alone hides.' },
              { phase: 'Go-Live & Optimisation', tools: ['Layout Recommendation'], detail: 'Quickly adapt approved content for every required output channel — email, WhatsApp, print — without duplicating authoring effort.' },
              { phase: 'Compliance & Audit', tools: ['Accessibility Check'], detail: 'Validate that every outbound document meets WCAG 2.1, PDF/UA, Section 508 and EN 301 549. Surface ranked issues with remediation guidance before content reaches customers.' },
            ].map(({ phase, tools, detail }) => (
              <div key={phase} className="md:pl-12 relative">
                <div className="absolute left-3.5 top-4 w-3 h-3 rounded-full bg-indigo-500 border-2 border-white dark:border-slate-900 hidden md:block" />
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 px-5 py-4 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{phase}</span>
                    {tools.map(t => (
                      <span key={t} className="text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">{t}</span>
                    ))}
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
};

export default Home;
