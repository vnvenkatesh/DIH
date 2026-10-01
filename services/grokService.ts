import { XPathMapping, DataMappingResult, SyntheticDataResult, LayoutRecommendationResult, AccessibilityResult, BusinessRulesResult, TestCaseResult } from '../types';
import { SETTINGS_STORAGE_KEY } from '../contexts/SettingsContext';

const AUTH_KEY = 'dih_auth';

let _accelerator = 'Other';

function getToken(): string {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || '{}').token || ''; }
    catch { return ''; }
}

function getGrokModel(): string {
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
        return s.grokModel || 'grok-4.3';
    } catch { return 'grok-4.3'; }
}

async function callGrok(model: string, messages: any[], jsonMode = false): Promise<any> {
    const body: Record<string, any> = { model, messages, accelerator: _accelerator };
    if (jsonMode) body.response_format = { type: 'json_object' };

    const resp = await fetch('/v1/llm/grok', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error((err as any)?.error?.message || (err as any)?.error || `Grok API error: ${resp.status}`);
    }
    return resp.json();
}

function extractText(response: any): string {
    const content = response?.choices?.[0]?.message?.content;
    if (!content) throw new Error('Unexpected Grok response format.');
    return content.trim();
}

function cleanJson(text: string): string {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return fenced[1].trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) return text.slice(start, end + 1);
    return text.trim();
}

function cleanJsonArray(text: string): string {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return fenced[1].trim();
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start !== -1 && end > start) return text.slice(start, end + 1);
    return cleanJson(text);
}

const xsdToXmlPrompt = `
You are an expert data architect and XML specialist.
Your task is to analyze the provided XML Schema (XSD) and generate a valid XML document populated with realistic, synthetic data.

Instructions:
1.  Parse the XSD to understand the structure, elements, attributes, and data types.
2.  Generate a valid XML document that strictly conforms to the schema.
3.  For every element and attribute, generate realistic, high-quality synthetic data based on its name and type.
    - Names: "John Doe", "Jane Smith"
    - Addresses: "782 Mallard Ln", "123 Main St"
    - Dates: Realistic dates in appropriate formats.
    - Numbers: Realistic values for counts, prices, etc.
4.  Ensure the XML is well-formed and valid against the provided XSD.
5.  **CRITICAL — Format the final output as a JSON object with BOTH fields populated:**
    - "fields": A JSON array listing EVERY element and attribute from the schema with its generated value. This array MUST NOT be empty. Each item must have exactly two keys: "field" (the element/attribute name as a string) and "value" (the generated synthetic value as a string).
    - "generatedXml": A string containing the full, valid XML document.
6.  The entire response must be ONLY the JSON object. Do not include any other text, comments, or markdown formatting.
`;

const dataMappingGeneratorPrompt = `
You are an expert template designer and data architect. Your task is to identify EVERY variable data field in a Word document and map each one to its XPath in an XSD schema.

Instructions:
1.  You will be given the HTML content of a Word document (which preserves table structure), the document's filename (Template Name), and the full text of an XSD file.

2.  **Extract EVERY Variable Field** — scan the entire document exhaustively. Include ALL of the following:
    - Explicit placeholders in any format: <FieldName>, [FieldName], {{FieldName}}, {FieldName}, <<FieldName>>
    - Labeled fields: any "Label:" or "Label -" or "Label " followed by a value, blank space, or underscores
    - Table cells: extract the column/row header as the field name and the corresponding data cell as the value — do NOT skip table fields
    - Blank lines or underscore sequences after a label (the label is the field name; the value is blank)
    - Any text that looks like it represents a data point with a label (e.g., "Date of Birth", "Policy Number", "Customer Name", "Address", "Amount Due")
    - Fields with actual filled-in values (extract both the label and the value)
    - ALL fields regardless of whether they appear filled in or empty

3.  **NEVER list fields from the XSD that are not present in the document.** Only include fields found in the Word document itself.

4.  **XSD Mapping:** For each field found in the document:
    - Search the XSD for an xs:element or xs:attribute whose name or path semantically matches the field.
    - If found, provide the full XPath (e.g., /Root/Customer/Name).
    - If NO match exists in the XSD, set xsdPath to exactly "path not found".

5.  **Sample Values:**
    - If the document has an actual value for the field, use it as sampleValue.
    - If the field is blank or a placeholder, generate a realistic synthetic sample value based on the field name (e.g., for "Date" use "2024-06-15", for "Name" use "Jane Smith").

6.  Use the provided Template Name for 'templateName'. Estimate 'pageNumber' from document position.

7.  **Generate XML:** Create a valid XML string conforming to the XSD using only the fields that have a valid XSD path. Use sample values to populate it.

8.  Return ONLY a JSON object — no markdown, no explanation:
    - "mappings": Array of objects, each with "field", "xsdPath", "sampleValue", "templateName", "pageNumber"
    - "generatedXml": Valid XML string (empty string if no fields mapped to XSD)
`;

const semanticComparePrompt = `
You are a meticulous quality assurance analyst. Your task is to compare two pages of a document and identify both semantic differences and semantically-equivalent paraphrases.

Instructions:
1. You will be given the text content of "Page A" and "Page B".
2. Analyze their meaning, intent, and the information they convey.
3. Identify TWO categories:
   a) kind="diff": Content where the meaning, facts, or information substantively differ — including additions, removals, or changed meaning.
   b) kind="same": Content where the meaning is identical but the wording, phrasing, or sentence structure is noticeably different (paraphrases, synonyms, restructured sentences).
4. Ignore purely cosmetic changes (trivial punctuation, capitalisation, or whitespace with no wording difference).
5. For each item provide:
    - "textA": The specific snippet from Page A. Use "" if the content is entirely new in Page B.
    - "textB": The specific snippet from Page B. Use "" if the content was removed from Page A.
    - "reason": A brief one-sentence explanation for kind="diff" items. Use "" for kind="same" items.
    - "kind": Either "diff" (meaning changed) or "same" (same meaning, different wording).
6. Format the final output as a JSON array of objects.
7. The entire response must be ONLY the JSON array. Do not include any other text, comments, or markdown formatting.
`;

const layoutRecommendationPrompt = `
You are a customer communications specialist. Analyze the provided customer communication document and reformat it into two concise versions.

Instructions:
1. EMAIL VERSION:
   - Start with a subject line prefixed exactly "Subject: " on the first line, followed by a blank line.
   - Write 2-4 short paragraphs. Separate each paragraph with a blank line (i.e., use \\n\\n between paragraphs).
   - Retain all key information: important dates, action items, account/reference numbers, and contact details.
   - Plain text only - no markdown, no bullet symbols, no asterisks.
2. WHATSAPP VERSION:
   - 5-7 lines maximum.
   - Each point on its own line separated by \\n.
   - Include ONLY the most critical information: what the customer needs to do, key dates or deadlines, and any important reference numbers.
   - Plain language, short sentences.

Return a JSON object with exactly two keys:
- "emailVersion": the complete email-optimised text as a plain string (paragraphs separated by \\n\\n)
- "whatsappVersion": the ultra-condensed WhatsApp-ready text as a plain string (lines separated by \\n)
The entire response must be ONLY the JSON object.
`;

const businessRulesPrompt = `You are an expert business analyst specialising in document automation and COTS implementation. Analyse the provided document and extract ALL business rules. The document may be any type — a customer communication, letter, template, form specification, or BRD. Reviewer comments (marked "DOCUMENT REVIEWER COMMENTS") are equally valid sources of rules.

RECOGNISE IMPLICIT RULES — business rules appear in many forms beyond explicit specifications:
- Template placeholders such as <Field Name>, [Field], $x,xxx, MM/DD/YYYY indicate fields that have Validation or Presentation rules
- Comments labelled for a specific state, region, or segment indicate Conditional rules (e.g. a comment "Privacy Statement for NY" means: print this section only when customer state = NY)
- Date arithmetic visible in the text (e.g. dispatch date 10/18, receive-by 10/30 implies a 12-day SLA gap) indicates a Calculation rule
- Currency amounts, formatted dates, email addresses, phone numbers indicate Presentation rules

Extract exactly four rule types:
1. VALIDATION — a field is required/mandatory, must match a pattern, or must pass a business check.
2. CONDITIONAL — an element is shown, printed, suppressed, or populated only when a condition is met.
3. CALCULATION — a value is derived, computed, or results from arithmetic or a lookup.
4. PRESENTATION — how a field must be displayed or formatted (no validation error, purely display).

For each rule return a JSON object with exactly these keys:
- fieldName, sourceReference, ruleType, condition, actionFormula, errorMessage, dependentFields, priority, pageReference

Return ONLY a JSON object with a single key "rules" containing the array. No markdown.`;

const accessibilityPrompt = `Analyse the extracted PDF text below for WCAG 2.1 Level A and AA compliance. This is text-only analysis, so visual/programmatic checks (alt text, contrast, tagged structure) must be "warning". Return ONLY valid JSON — no markdown, nothing else:
{"overallScore":70,"grade":"C","summary":"The document has clear headings but missing language declaration and unverifiable alt text.","standards":[{"name":"WCAG 2.1","score":70,"criteria":[{"id":"1.1.1","standard":"WCAG 2.1","level":"A","name":"Non-text Content","status":"warning","severity":"major","issue":"Alt text cannot be verified from extracted text.","recommendation":"Open in Acrobat, run Accessibility Checker, add alt text to all images."}]}],"criticalIssues":0,"majorIssues":2,"minorIssues":1,"passed":4,"totalChecked":7}
Rules: grade A=90-100 B=75-89 C=60-74 D=40-59 F=0-39; status=pass/fail/warning; severity+issue+recommendation only for fail/warning; severity=critical/major/minor; evaluate 8-12 WCAG 2.1 criteria; output ONLY the JSON object.`;

const testCasePrompt = `You are a senior QA engineer specialising in enterprise COTS implementation testing.

Given a set of extracted business rules, generate comprehensive test cases. Apply the following strategy per rule type:

VALIDATION rules → one happy-path, one mandatory-failure, one format/value violation test.
CONDITIONAL rules → BOTH a TRUE-branch and a FALSE-branch test.
CALCULATION rules → one valid-inputs test and one boundary test.
PRESENTATION rules → one correctly-formatted and one incorrectly-formatted test.

For each test case return:
- fieldSection, category ("Happy Path"|"Mandatory"|"Boundary"|"Conditional"|"Format"|"Calculation"), testDescription, inputData, expectedResult, priority ("High"|"Medium"|"Low"), preconditions, testSteps

Return ONLY a JSON object with a single key "testCases" containing the array. No markdown.`;

export const generateSyntheticDataFromXsd = async (xsdContent: string): Promise<SyntheticDataResult> => {
    _accelerator = 'Synthetic Data Generator';
    const result = await callGrok(getGrokModel(), [{ role: 'user', content: `${xsdToXmlPrompt}\n\n--- XML SCHEMA (XSD) ---\n\n${xsdContent}` }], true);
    return JSON.parse(cleanJson(extractText(result))) as SyntheticDataResult;
};

// Grok does not support inline PDF base64 — XPath Extractor requires Gemini, Claude, or OpenAI.
export const extractXPaths = async (): Promise<XPathMapping[]> => {
    throw new Error('XPath Extractor requires a PDF-capable provider. Please switch to Gemini, Claude, or OpenAI using the AI selector in the top-right menu.');
};

export const generateDataMap = async (docxContent: string, xsdContent: string, templateName: string): Promise<DataMappingResult> => {
    _accelerator = 'Data Mapping Generator';
    const result = await callGrok(getGrokModel(), [{ role: 'user', content: `${dataMappingGeneratorPrompt}\n\n--- TEMPLATE NAME ---\n\n${templateName}\n\n--- WORD DOCUMENT CONTENT (HTML) ---\n\n${docxContent}\n\n--- XSD CONTENT ---\n\n${xsdContent}` }], true);
    return JSON.parse(cleanJson(extractText(result))) as DataMappingResult;
};

export const performSemanticComparison = async (textA: string, textB: string): Promise<Array<{ textA: string; textB: string; reason: string; kind: 'diff' | 'same' }>> => {
    _accelerator = 'PDF Compare';
    try {
        const result = await callGrok(getGrokModel(), [{ role: 'user', content: `${semanticComparePrompt}\n\n--- Page A ---\n\n${textA}\n\n--- Page B ---\n\n${textB}` }]);
        return JSON.parse(cleanJsonArray(extractText(result)));
    } catch (error) {
        console.error('Error calling Grok API for semantic comparison:', error);
        return [];
    }
};

export const generateLayoutRecommendations = async (documentText: string): Promise<LayoutRecommendationResult> => {
    _accelerator = 'Layout Recommendation';
    const result = await callGrok(getGrokModel(), [{ role: 'user', content: `${layoutRecommendationPrompt}\n\n--- DOCUMENT CONTENT ---\n\n${documentText}` }], true);
    return JSON.parse(cleanJson(extractText(result))) as LayoutRecommendationResult;
};

export const scoreAccessibility = async (documentText: string, _fileName: string): Promise<AccessibilityResult> => {
    _accelerator = 'Accessibility Scorer';
    const result = await callGrok(getGrokModel(), [{ role: 'user', content: `${accessibilityPrompt}\n\n--- DOCUMENT TEXT ---\n\n${documentText}` }], true);
    return JSON.parse(cleanJson(extractText(result))) as AccessibilityResult;
};

export const extractBusinessRules = async (docText: string): Promise<BusinessRulesResult> => {
    _accelerator = 'Business Rules';
    const result = await callGrok(getGrokModel(), [{ role: 'user', content: `${businessRulesPrompt}\n\n--- DOCUMENT CONTENT ---\n\n${docText}` }], true);
    return JSON.parse(cleanJson(extractText(result))) as BusinessRulesResult;
};

export const generateTestCases = async (rulesAndHints: string): Promise<TestCaseResult> => {
    _accelerator = 'Test Case Generator';
    const result = await callGrok(getGrokModel(), [{ role: 'user', content: `${testCasePrompt}\n\n${rulesAndHints}` }], true);
    return JSON.parse(cleanJson(extractText(result))) as TestCaseResult;
};
