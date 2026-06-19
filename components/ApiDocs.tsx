
import React, { useState } from 'react';

const BASE_URL = `${window.location.origin}/v1`;

interface Param {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

interface ApiEndpoint {
  id: string;
  method: 'POST' | 'GET';
  path: string;
  title: string;
  shortDescription: string;
  description: string;
  requestParams: Param[];
  responseParams: Param[];
  curlExample: string;
  requestExample: string;
  responseExample: string;
}

const APIS: ApiEndpoint[] = [
  {
    id: 'rationalizer',
    method: 'POST',
    path: '/rationalizer',
    title: 'Rationalizer',
    shortDescription: 'Group similar PDFs by content or semantic similarity',
    description:
      'Accepts a collection of PDF documents and groups them by either exact hash-based matching or AI-powered semantic similarity clustering. Returns groups of documents that are redundant or closely related, along with a similarity score for each group.',
    requestParams: [
      { name: 'files', type: 'File (multipart)', required: true, description: 'One or more PDF files. Repeat the field for each file: -F "files=@file1.pdf" -F "files=@file2.pdf".' },
      { name: 'mode', type: '"exact" | "semantic"', required: false, description: 'Grouping strategy. `exact` uses SHA-256 hash matching. `semantic` uses AI embeddings. Defaults to `"semantic"`.' },
      { name: 'similarityThreshold', type: 'number (70–99)', required: false, description: 'Minimum cosine similarity percentage to consider two documents related. Only applies when `mode` is `"semantic"`. Defaults to `80`.' },
    ],
    responseParams: [
      { name: 'groups', type: 'Group[]', required: true, description: 'Array of document groups that meet the similarity threshold.' },
      { name: 'groups[].id', type: 'number', required: true, description: 'Zero-based group index.' },
      { name: 'groups[].similarity', type: 'number', required: true, description: 'Average similarity percentage (0–100) among documents in this group.' },
      { name: 'groups[].documents', type: 'DocumentRef[]', required: true, description: 'List of documents belonging to this group.' },
      { name: 'groups[].documents[].filename', type: 'string', required: true, description: 'Original filename of the PDF.' },
      { name: 'groups[].documents[].pageCount', type: 'number', required: true, description: 'Number of pages in the document.' },
    ],
    curlExample: `curl -X POST "${BASE_URL}/rationalizer" -F "files=@policy_v1.pdf" -F "files=@policy_v2.pdf" -F "files=@invoice_template.pdf" -F "mode=semantic" -F "similarityThreshold=85"`,
    requestExample: `POST ${BASE_URL}/rationalizer
Content-Type: multipart/form-data

files                = @policy_v1.pdf
files                = @policy_v2.pdf
files                = @invoice_template.pdf
mode                 = semantic
similarityThreshold  = 85`,
    responseExample: `HTTP/1.1 200 OK
Content-Type: application/json

{
  "groups": [
    {
      "id": 0,
      "similarity": 92,
      "documents": [
        { "filename": "policy_v1.pdf", "pageCount": 4 },
        { "filename": "policy_v2.pdf", "pageCount": 4 }
      ]
    }
  ]
}`,
  },
  {
    id: 'pdf-compare',
    method: 'POST',
    path: '/pdf-compare',
    title: 'PDF Compare',
    shortDescription: 'Detect textual or semantic differences between two PDFs',
    description:
      'Compares two PDF documents page-by-page and returns structured differences. In exact mode, text is diffed at the paragraph level. In semantic mode, Google Gemini identifies meaningful meaning changes and returns an explanation for each difference.',
    requestParams: [
      { name: 'fileA', type: 'File (multipart)', required: true, description: 'The reference PDF file.' },
      { name: 'fileB', type: 'File (multipart)', required: true, description: 'The PDF to compare against the reference.' },
      { name: 'mode', type: '"exact" | "semantic"', required: false, description: '`exact` diffs text at the paragraph level. `semantic` uses AI to find meaning-level changes. Defaults to `"exact"`.' },
    ],
    responseParams: [
      { name: 'totalDifferences', type: 'number', required: true, description: 'Total count of differences found across all pages.' },
      { name: 'differences', type: 'PageDiff[]', required: true, description: 'Per-page difference list.' },
      { name: 'differences[].page', type: 'number', required: true, description: 'Page number (1-based) on which the difference was found.' },
      { name: 'differences[].type', type: '"added" | "removed" | "modified" | "semantic"', required: true, description: 'Nature of the change.' },
      { name: 'differences[].textA', type: 'string', required: true, description: 'Original text snippet from `fileA`.' },
      { name: 'differences[].textB', type: 'string', required: true, description: 'Changed text snippet from `fileB`.' },
      { name: 'differences[].reason', type: 'string', required: false, description: 'AI-generated explanation of the semantic change. Present only when `mode` is `"semantic"`.' },
    ],
    curlExample: `curl -X POST "${BASE_URL}/pdf-compare" -F "fileA=@contract_v1.pdf" -F "fileB=@contract_v2.pdf" -F "mode=semantic"`,
    requestExample: `POST ${BASE_URL}/pdf-compare
Content-Type: multipart/form-data

fileA  = @contract_v1.pdf
fileB  = @contract_v2.pdf
mode   = semantic`,
    responseExample: `HTTP/1.1 200 OK
Content-Type: application/json

{
  "totalDifferences": 2,
  "differences": [
    {
      "page": 2,
      "type": "semantic",
      "textA": "Payment is due within 30 days.",
      "textB": "Payment is due within 14 days.",
      "reason": "Payment terms shortened from 30 days to 14 days — a significant commercial change."
    },
    {
      "page": 3,
      "type": "removed",
      "textA": "This agreement is governed by the laws of New York.",
      "textB": "",
      "reason": null
    }
  ]
}`,
  },
  {
    id: 'data-mapping',
    method: 'POST',
    path: '/data-mapping',
    title: 'Data Mapping Generator',
    shortDescription: 'Map Word document fields to XSD schema paths and generate XML',
    description:
      'Extracts fields from a Word document (.docx) and maps each one to the most semantically appropriate XSD element or attribute path. Returns the full mapping table plus a ready-to-use XML document populated with sample values derived from the source document.',
    requestParams: [
      { name: 'docx', type: 'File (multipart)', required: true, description: 'The Word document (.docx) containing the fields to map.' },
      { name: 'xsd', type: 'File (multipart)', required: true, description: 'The XSD schema file (.xsd) that defines the target data model.' },
    ],
    responseParams: [
      { name: 'mappings', type: 'DataMapping[]', required: true, description: 'Array of field-to-XSD mappings.' },
      { name: 'mappings[].field', type: 'string', required: true, description: 'Field name as identified in the Word document.' },
      { name: 'mappings[].xsdPath', type: 'string', required: true, description: 'Dot-notation or XPath-style path to the matching XSD element.' },
      { name: 'mappings[].sampleValue', type: 'string', required: true, description: 'Sample value extracted or inferred from the document.' },
      { name: 'mappings[].templateName', type: 'string', required: true, description: 'Source template section or form name.' },
      { name: 'mappings[].pageNumber', type: 'string', required: true, description: 'Page in the source document where the field appears.' },
      { name: 'generatedXml', type: 'string', required: true, description: 'Complete XML document conforming to the XSD, populated with mapped sample values.' },
    ],
    curlExample: `curl -X POST "${BASE_URL}/data-mapping" -F "docx=@document.docx" -F "xsd=@schema.xsd"`,
    requestExample: `POST ${BASE_URL}/data-mapping
Content-Type: multipart/form-data

docx  = @document.docx
xsd   = @schema.xsd`,
    responseExample: `HTTP/1.1 200 OK
Content-Type: application/json

{
  "mappings": [
    {
      "field": "Customer Name",
      "xsdPath": "Customer/PersonalInfo/FullName",
      "sampleValue": "Jane Doe",
      "templateName": "Customer Onboarding Form",
      "pageNumber": "1"
    },
    {
      "field": "Account Number",
      "xsdPath": "Customer/Account/AccountId",
      "sampleValue": "ACC-20941",
      "templateName": "Customer Onboarding Form",
      "pageNumber": "1"
    }
  ],
  "generatedXml": "<?xml version=\\"1.0\\"?>\\n<Customer>\\n  <PersonalInfo>..."
}`,
  },
  {
    id: 'xpath-extractor',
    method: 'POST',
    path: '/xpath-extractor',
    title: 'XPath Extractor',
    shortDescription: 'Extract values from a PDF and map them to XML XPath locations',
    description:
      'Takes a PDF document and an XML template, then uses AI to identify data values in the PDF and match each one to the appropriate XPath in the XML structure. Returns a mapping table suitable for automated data-fill pipelines.',
    requestParams: [
      { name: 'pdf', type: 'File (multipart)', required: true, description: 'The PDF file to extract data values from.' },
      { name: 'xml', type: 'File (multipart)', required: true, description: 'The XML template file (.xml) that defines the target document structure.' },
    ],
    responseParams: [
      { name: 'mappings', type: 'XPathMapping[]', required: true, description: 'Array of extracted value-to-XPath mappings.' },
      { name: 'mappings[].value', type: 'string', required: true, description: 'Data value extracted from the PDF.' },
      { name: 'mappings[].xpath', type: 'string', required: true, description: 'Full XPath expression pointing to the target XML node.' },
      { name: 'mappings[].templateName', type: 'string', required: true, description: 'Name of the PDF template or form the value was found in.' },
      { name: 'mappings[].pageNumber', type: 'string', required: true, description: 'Page number in the PDF where the value was extracted.' },
      { name: 'mappings[].fieldType', type: 'string', required: true, description: 'Inferred field type (e.g. `"text"`, `"date"`, `"currency"`, `"boolean"`).' },
    ],
    curlExample: `curl -X POST "${BASE_URL}/xpath-extractor" -F "pdf=@document.pdf" -F "xml=@template.xml"`,
    requestExample: `POST ${BASE_URL}/xpath-extractor
Content-Type: multipart/form-data

pdf  = @document.pdf
xml  = @template.xml`,
    responseExample: `HTTP/1.1 200 OK
Content-Type: application/json

{
  "mappings": [
    {
      "value": "INV-2024-00342",
      "xpath": "/Invoice/Header/InvoiceNumber",
      "templateName": "invoice_template.pdf",
      "pageNumber": "1",
      "fieldType": "text"
    },
    {
      "value": "2024-11-15",
      "xpath": "/Invoice/Header/Date",
      "templateName": "invoice_template.pdf",
      "pageNumber": "1",
      "fieldType": "date"
    }
  ]
}`,
  },
  {
    id: 'synthetic-data',
    method: 'POST',
    path: '/synthetic-data',
    title: 'Synthetic Data Generation',
    shortDescription: 'Generate realistic synthetic data from an XSD schema',
    description:
      'Reads an XSD schema and uses AI to infer contextually appropriate synthetic data values for every field. Returns both a structured field list with sample values and a fully populated XML document that is valid against the provided schema.',
    requestParams: [
      { name: 'xsd', type: 'File (multipart)', required: true, description: 'The XSD schema file (.xsd). All element and attribute types are used to infer realistic sample values.' },
    ],
    responseParams: [
      { name: 'fields', type: 'FormField[]', required: true, description: 'List of fields extracted from the schema with generated sample values.' },
      { name: 'fields[].field', type: 'string', required: true, description: 'Field name as defined in the XSD.' },
      { name: 'fields[].value', type: 'string', required: true, description: 'AI-generated synthetic value appropriate for the field name and type.' },
      { name: 'generatedXml', type: 'string', required: true, description: 'A complete XML document conforming to the XSD, populated with all generated sample values.' },
    ],
    curlExample: `curl -X POST "${BASE_URL}/synthetic-data" -F "xsd=@schema.xsd"`,
    requestExample: `POST ${BASE_URL}/synthetic-data
Content-Type: multipart/form-data

xsd  = @schema.xsd`,
    responseExample: `HTTP/1.1 200 OK
Content-Type: application/json

{
  "fields": [
    { "field": "FirstName", "value": "Marcus" },
    { "field": "DOB",       "value": "1988-03-22" }
  ],
  "generatedXml": "<?xml version=\\"1.0\\"?>\\n<Customer>\\n  <FirstName>Marcus</FirstName>\\n  <DOB>1988-03-22</DOB>\\n</Customer>"
}`,
  },
  {
    id: 'pdf-exact-compare',
    method: 'POST',
    path: '/pdf-exact-compare',
    title: 'PDF Exact Compare',
    shortDescription: 'No-AI word-level diff with optional font & colour detection',
    description:
      'Compares two PDF documents page-by-page using word-level exact diffing — no AI involved. Pass diffMode=simple (default) to also detect font size and style changes, or diffMode=precise to additionally attempt fill-colour detection. Requires a valid Bearer token (login via /v1/auth/login).',
    requestParams: [
      { name: 'fileA', type: 'File (multipart)', required: true, description: 'The reference PDF file.' },
      { name: 'fileB', type: 'File (multipart)', required: true, description: 'The PDF to compare against the reference.' },
      { name: 'diffMode', type: '"simple" | "precise"', required: false, description: '`simple` (default) adds font size & style detection on top of text diff. `precise` additionally attempts fill-colour comparison.' },
    ],
    responseParams: [
      { name: 'totalDifferences', type: 'number', required: true, description: 'Total count of differences found across all pages.' },
      { name: 'differences', type: 'PageDiff[]', required: true, description: 'Per-page difference list.' },
      { name: 'differences[].page', type: 'number', required: true, description: 'Page number (1-based) where the difference was found.' },
      { name: 'differences[].type', type: '"added" | "removed" | "modified" | "font" | "color"', required: true, description: 'Nature of the change. `font` means same text but different font size or style. `color` means same text but different fill colour (precise mode only).' },
      { name: 'differences[].textA', type: 'string', required: true, description: 'Original text from fileA.' },
      { name: 'differences[].textB', type: 'string', required: true, description: 'Changed text from fileB.' },
      { name: 'differences[].reason', type: 'string | null', required: true, description: 'Human-readable description of the font or colour change. null for text-content diffs.' },
    ],
    curlExample: `curl -X POST "${BASE_URL}/pdf-exact-compare" \\\n  -H "Authorization: Bearer <token>" \\\n  -F "fileA=@contract_v1.pdf" \\\n  -F "fileB=@contract_v2.pdf" \\\n  -F "diffMode=simple"`,
    requestExample: `POST ${BASE_URL}/pdf-exact-compare
Content-Type: multipart/form-data
Authorization: Bearer <token>

fileA     = @contract_v1.pdf
fileB     = @contract_v2.pdf
diffMode  = simple`,
    responseExample: `HTTP/1.1 200 OK
Content-Type: application/json

{
  "totalDifferences": 3,
  "differences": [
    {
      "page": 1,
      "type": "modified",
      "textA": "Payment due within 30 days.",
      "textB": "Payment due within 14 days.",
      "reason": null
    },
    {
      "page": 1,
      "type": "font",
      "textA": "TERMS AND CONDITIONS",
      "textB": "TERMS AND CONDITIONS",
      "reason": "Font changed — size 10.0pt → 14.0pt"
    }
  ]
}`,
  },
  {
    id: 'api-exact-compare',
    method: 'POST',
    path: '/api/exact-compare',
    title: 'Exact Compare (Basic Auth)',
    shortDescription: 'Structured exact diff with severity, position, and font detection',
    description:
      'Compares two PDFs with word-level exact diffing and returns a richly structured JSON response including a sequential diff ID, page number, diff type, page position (Top/Middle/Bottom), and severity (Major/Minor). Supports the same diffMode options as /pdf-exact-compare. Protected by HTTP Basic Authentication — pass credentials as base64-encoded username:password in the Authorization header.',
    requestParams: [
      { name: 'fileA', type: 'File (multipart)', required: true, description: 'The reference PDF file.' },
      { name: 'fileB', type: 'File (multipart)', required: true, description: 'The PDF to compare against the reference.' },
      { name: 'diffMode', type: '"simple" | "precise"', required: false, description: '`simple` (default) adds font size & style detection. `precise` additionally attempts fill-colour comparison.' },
    ],
    responseParams: [
      { name: 'areDocumentsSame', type: '"Yes" | "No"', required: true, description: 'Whether the two documents are identical.' },
      { name: 'differences.difference', type: 'Diff[]', required: true, description: 'Array of structured difference objects.' },
      { name: 'differences.difference[].diffID', type: 'number', required: true, description: 'Sequential identifier for this difference, starting at 1.' },
      { name: 'differences.difference[].PageNumber', type: 'number', required: true, description: 'Page number (1-based) where the difference was found.' },
      { name: 'differences.difference[].typeOfDiff', type: '"added" | "removed" | "modified" | "Font" | "Color"', required: true, description: 'Nature of the change.' },
      { name: 'differences.difference[].positionInPage', type: '"Top" | "Middle" | "Bottom"', required: true, description: 'Approximate vertical position of the difference on the page relative to other diffs on that page.' },
      { name: 'differences.difference[].diffSeverity', type: '"Major" | "Minor"', required: true, description: 'Major if the changed text is ≥5 words; Minor otherwise. Font/Color diffs are always Minor.' },
      { name: 'differences.difference[].textA', type: 'string', required: true, description: 'Original text from fileA.' },
      { name: 'differences.difference[].textB', type: 'string', required: true, description: 'Changed text from fileB.' },
      { name: 'differences.difference[].reason', type: 'string', required: false, description: 'Description of a font or colour change. Omitted for text-content diffs.' },
    ],
    curlExample: `curl -X POST "${BASE_URL}/api/exact-compare" \\\n  -H "Authorization: Basic $(echo -n 'admin:Admin@123' | base64)" \\\n  -F "fileA=@contract_v1.pdf" \\\n  -F "fileB=@contract_v2.pdf" \\\n  -F "diffMode=simple"`,
    requestExample: `POST ${BASE_URL}/api/exact-compare
Content-Type: multipart/form-data
Authorization: Basic YWRtaW46QWRtaW5AMTIz

fileA     = @contract_v1.pdf
fileB     = @contract_v2.pdf
diffMode  = simple`,
    responseExample: `HTTP/1.1 200 OK
Content-Type: application/json

{
  "areDocumentsSame": "No",
  "differences": {
    "difference": [
      {
        "diffID": 1,
        "PageNumber": 1,
        "typeOfDiff": "modified",
        "positionInPage": "Top",
        "diffSeverity": "Major",
        "textA": "Payment due within 30 days.",
        "textB": "Payment due within 14 days."
      },
      {
        "diffID": 2,
        "PageNumber": 1,
        "typeOfDiff": "Font",
        "positionInPage": "Middle",
        "diffSeverity": "Minor",
        "textA": "TERMS AND CONDITIONS",
        "textB": "TERMS AND CONDITIONS",
        "reason": "Font changed — size 10.0pt → 14.0pt"
      }
    ]
  }
}`,
  },
  {
    id: 'layout-recommendation',
    method: 'POST',
    path: '/layout-recommendation',
    title: 'Layout Recommendation',
    shortDescription: 'Adapt a document into optimised email and WhatsApp versions',
    description:
      'Accepts a PDF or Word document and returns two AI-generated content adaptations: one reformatted for email (preserving structure and HTML-friendliness) and one condensed for WhatsApp (plain text, concise, emoji-optional). Useful for omni-channel communication workflows.',
    requestParams: [
      { name: 'file', type: 'File (multipart)', required: true, description: 'The document to adapt. Accepts .pdf or .docx — file type is detected automatically from the filename extension.' },
    ],
    responseParams: [
      { name: 'emailVersion', type: 'string', required: true, description: 'Full document content restructured and formatted for an email channel. May include lightweight HTML.' },
      { name: 'whatsappVersion', type: 'string', required: true, description: 'Condensed plain-text version suitable for WhatsApp messaging, with key information preserved.' },
    ],
    curlExample: `curl -X POST "${BASE_URL}/layout-recommendation" -F "file=@document.pdf"`,
    requestExample: `POST ${BASE_URL}/layout-recommendation
Content-Type: multipart/form-data

file  = @document.pdf`,
    responseExample: `HTTP/1.1 200 OK
Content-Type: application/json

{
  "emailVersion": "<h2>Your Statement Summary</h2>\\n<p>Dear Marcus,</p>\\n<p>Your account statement for <strong>November 2024</strong> is ready...</p>",
  "whatsappVersion": "Hi Marcus! Your Nov 2024 statement is ready. Total spend: $1,240. Min payment due: $50 by Dec 15. Reply HELP for assistance."
}`,
  },
];

// ── Sub-components ──────────────────────────────────────────────

const MethodBadge: React.FC<{ method: string }> = ({ method }) => (
  <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-bold tracking-wide uppercase ${
    method === 'POST' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
  }`}>
    {method}
  </span>
);

const RequiredBadge: React.FC<{ required: boolean }> = ({ required }) => (
  <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
    required ? 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
  }`}>
    {required ? 'required' : 'optional'}
  </span>
);

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="absolute top-3 right-3 px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
};

const CodeBlock: React.FC<{ code: string }> = ({ code }) => (
  <div className="relative">
    <pre className="text-xs leading-relaxed text-slate-300 bg-slate-900 rounded-lg p-4 overflow-x-auto whitespace-pre pr-16">
      {code}
    </pre>
    <CopyButton text={code} />
  </div>
);

const ParamsTable: React.FC<{ params: Param[] }> = ({ params }) => (
  <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-slate-50 dark:bg-slate-800 text-left">
          <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300 w-48">Parameter</th>
          <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300 w-40">Type</th>
          <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300 w-24">Required</th>
          <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Description</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
        {params.map((p, i) => (
          <tr key={i} className="bg-white dark:bg-slate-800/40 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
            <td className="px-4 py-3 font-mono text-xs text-indigo-600 dark:text-indigo-400 font-semibold align-top">{p.name}</td>
            <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400 align-top">{p.type}</td>
            <td className="px-4 py-3 align-top"><RequiredBadge required={p.required} /></td>
            <td className="px-4 py-3 text-slate-600 dark:text-slate-300 text-xs leading-relaxed align-top">{p.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// ── Main Component ──────────────────────────────────────────────

const ApiDocs: React.FC = () => {
  const [activeId, setActiveId] = useState<string>(APIS[0].id);
  const [activeTab, setActiveTab] = useState<'request' | 'response' | 'example'>('request');

  const api = APIS.find(a => a.id === activeId)!;

  return (
    <div className="flex gap-6 min-h-0">
      {/* ── API selector sidebar ── */}
      <aside className="w-56 flex-shrink-0">
        <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 px-1">Endpoints</p>
        <nav className="space-y-1">
          {APIS.map(a => (
            <button
              key={a.id}
              onClick={() => { setActiveId(a.id); setActiveTab('request'); }}
              className={`w-full flex items-start gap-2 px-3 py-2.5 rounded-lg text-left transition-all duration-150 group ${
                activeId === a.id
                  ? 'bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-700/40 border border-transparent'
              }`}
            >
              <MethodBadge method={a.method} />
              <span className={`text-xs font-medium leading-snug mt-0.5 ${activeId === a.id ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-600 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white'}`}>
                {a.title}
              </span>
            </button>
          ))}
        </nav>

        <div className="mt-8 px-1">
          <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Base URL</p>
          <code className="text-xs text-slate-500 dark:text-slate-400 break-all leading-relaxed">{BASE_URL}</code>
        </div>

        <div className="mt-6 px-1">
          <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Auth</p>
          {['pdf-exact-compare'].includes(activeId)
            ? <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">Bearer token — obtain via <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">/v1/auth/login</code>.</p>
            : ['api-exact-compare'].includes(activeId)
            ? <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">HTTP Basic Auth — <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">Authorization: Basic base64(user:pass)</code>.</p>
            : <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">No authentication required.</p>
          }
        </div>
      </aside>

      {/* ── API Detail ── */}
      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="mb-6 pb-5 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3 mb-2">
            <MethodBadge method={api.method} />
            <code className="text-sm font-mono font-semibold text-slate-700 dark:text-slate-200">
              {BASE_URL}<span className="text-indigo-600 dark:text-indigo-400">{api.path}</span>
            </code>
          </div>
          <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed max-w-2xl">{api.description}</p>
        </div>

        {/* Tab selector */}
        <div className="flex gap-1 mb-5 border-b border-slate-200 dark:border-slate-700">
          {(['request', 'response', 'example'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              {tab === 'request' ? 'Request Body' : tab === 'response' ? 'Response Schema' : 'Examples'}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'request' && (
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              Send as <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">multipart/form-data</code>. Pass files directly — no base64 encoding needed. curl sets the content type automatically when you use <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">-F</code>.
            </p>
            <ParamsTable params={api.requestParams} />
          </div>
        )}

        {activeTab === 'response' && (
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              All successful responses return <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">HTTP 200</code> with{' '}
              <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">application/json</code>.
              Errors return <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">4xx</code> / <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">5xx</code> with a{' '}
              <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">{'{"error": "message"}'}</code> body.
            </p>
            <ParamsTable params={api.responseParams} />
          </div>
        )}

        {activeTab === 'example' && (
          <div className="space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">cURL</p>
                <span className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded font-mono">shell</span>
              </div>
              <CodeBlock code={api.curlExample} />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">HTTP Request</p>
                <span className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded font-mono">json</span>
              </div>
              <CodeBlock code={api.requestExample} />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Response</p>
                <span className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded font-mono">json</span>
              </div>
              <CodeBlock code={api.responseExample} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ApiDocs;
