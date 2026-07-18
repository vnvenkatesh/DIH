
import { XPathMapping, DataMappingResult, SyntheticDataResult, LayoutRecommendationResult, AccessibilityResult, BusinessRulesResult, TestCaseResult } from '../types';
import { SETTINGS_STORAGE_KEY } from '../contexts/SettingsContext';

const AUTH_KEY = 'dih_auth';

function getToken(): string {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || '{}').token || ''; }
    catch { return ''; }
}

function getGeminiModel(): string {
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
        return s.geminiModel || getGeminiModel();
    } catch { return getGeminiModel(); }
}

let _accelerator = 'Other';

async function callGemini(model: string, contents: object[], generationConfig: object): Promise<any> {
    const resp = await fetch('/v1/llm/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ model, contents, generationConfig, accelerator: _accelerator }),
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error((err as any)?.error?.message || (err as any)?.error || `Gemini API error ${resp.status}: ${resp.statusText}`);
    }

    return resp.json();
}

// Thinking models emit "thought" parts before the final output.
function extractJsonText(result: any): string {
    const parts: any[] = result?.candidates?.[0]?.content?.parts ?? [];
    const finalParts = parts.filter((p: any) => p.text !== undefined && !p.thought);
    const text = (finalParts.length > 0 ? finalParts.map((p: any) => p.text).join('') : '').trim();
    if (!text) throw new Error('Gemini returned an empty response. Please try again.');
    return text;
}

const fieldExtractorPrompt = `
You are a highly skilled business analyst specializing in document processing.
Your task is to analyze the provided PDF document, extract all fillable fields and their corresponding values, and optionally map them to an XML Schema (XSD) to generate a valid XML.

Instructions:
1.  Thoroughly scan the document to identify labels for form fields (e.g., "Name", "Address", "Date of Birth", "Policy Number").
2.  Extract the text that corresponds to each label as its value.
3.  **Crucially, if a field is identified but its value is blank, missing, or empty, you MUST generate realistic, synthetic data for it.**
4.  Use the following examples for synthetic data generation:
    - Name: "John Doe"
    - Address Line 1: "782 Mallard Ln"
    - City: "Pleasantville"
    - State: "CA"
    - Zip Code: "60090"
    - Phone Number: "(555) 123-4567"
    - Email: "john.doe@example.com"
5.  **XML Generation (If XSD provided):** If an XSD schema is provided, map the extracted fields to the appropriate elements in the schema and generate a valid XML string populated with the extracted/synthetic data.
6.  Format the final output as a JSON object with:
    - "fields": A JSON array of objects, where each object has a "field" key and a "value" key.
    - "generatedXml": (Optional) A string containing the full, valid XML if an XSD was provided.
7.  The entire response must be ONLY the JSON object. Do not include any other text, comments, or markdown formatting.
`;

const xPathExtractorPrompt = `
You are an expert document specialist tasked with mapping dynamic data from a PDF to its source XML.

Instructions:
1.  You will be given a PDF file, a Template Name, and its corresponding source XML file.
2.  Parse the XML to identify all text values (the content of the leaf nodes).
3.  For each text value from the XML, search for its presence in the PDF document.
4.  **Use intelligent matching.** For example, if the PDF has "Acme Corp." and the XML has "Acme Corporation," you should identify this as a match. Similarly, handle minor differences in formatting (dates, currencies, etc.).
5.  For each identified match, determine:
    - The text value found in the PDF.
    - The full, absolute XPath of that element in the XML.
    - The estimated **Page Number** in the PDF where this value appears (e.g., "1").
    - The **Data Type** of the field based on the XML value (e.g., "String", "Date", "Currency", "Integer", "Boolean").
    - Use the provided **Template Name** for the 'templateName' field.
6.  **CRITICAL — Compile ALL successful mappings. The result array MUST NOT be empty** unless the PDF and XML share absolutely no matching values whatsoever.
7.  Format the final output as a JSON array of objects. Each object must have exactly the keys: "value", "xpath", "templateName", "pageNumber", "fieldType".
8.  The entire response must be ONLY the JSON array. Do not include any other text, comments, or markdown formatting.
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
    - "textA": The specific snippet from Page A. Use an empty string if the content is entirely new in Page B.
    - "textB": The specific snippet from Page B. Use an empty string if the content was removed from Page A.
    - "reason": A brief one-sentence explanation for kind="diff" items. Use an empty string for kind="same" items.
    - "kind": Either "diff" (meaning changed) or "same" (same meaning, different wording).
6. Format the final output as a JSON array of objects.
7. The entire response must be ONLY the JSON array. Do not include any other text, comments, or markdown formatting.
`;

const xsdToXmlPrompt = `
You are an expert data architect and XML specialist.
Your task is to analyze the provided XML Schema (XSD) and generate a valid XML document populated with realistic, synthetic data.

Instructions:
1.  Parse the XSD to understand the structure, elements, attributes, and data types.
2.  Generate a valid XML document that strictly conforms to the schema.
3.  **Synthetic Data Generation:** For every element and attribute, generate realistic, high-quality synthetic data based on its name and type.
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

export const generateSyntheticDataFromXsd = async (xsdContent: string): Promise<SyntheticDataResult> => {
    _accelerator = 'Synthetic Data Generator';
    try {
        const result = await callGemini(
            getGeminiModel(),
            [{ parts: [{ text: xsdToXmlPrompt }, { text: `\n\n--- XML SCHEMA (XSD) ---\n\n${xsdContent}` }] }],
            {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'OBJECT',
                    properties: {
                        fields: {
                            type: 'ARRAY',
                            items: {
                                type: 'OBJECT',
                                properties: {
                                    field: { type: 'STRING', description: 'The name of the element or attribute.' },
                                    value: { type: 'STRING', description: 'The generated synthetic value.' },
                                },
                                required: ['field', 'value'],
                            },
                        },
                        generatedXml: { type: 'STRING', description: 'The generated XML string.' },
                    },
                    required: ['fields', 'generatedXml'],
                },
            }
        );
        return JSON.parse(extractJsonText(result)) as SyntheticDataResult;
    } catch (error) {
        console.error('Gemini generateSyntheticDataFromXsd error:', error);
        throw error;
    }
};

export const extractXPaths = async (
    pdfBase64: string,
    pdfMimeType: string,
    xmlContent: string,
    templateName: string
): Promise<XPathMapping[]> => {
    _accelerator = 'XPath Extractor';
    try {
        const result = await callGemini(
            getGeminiModel(),
            [{
                parts: [
                    { text: `${xPathExtractorPrompt}\n\n--- TEMPLATE NAME ---\n\n${templateName}` },
                    { inlineData: { mimeType: pdfMimeType, data: pdfBase64 } },
                    { text: `\n\n--- XML CONTENT ---\n\n${xmlContent}` },
                ],
            }],
            {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'ARRAY',
                    items: {
                        type: 'OBJECT',
                        properties: {
                            value: { type: 'STRING' },
                            xpath: { type: 'STRING' },
                            templateName: { type: 'STRING' },
                            pageNumber: { type: 'STRING' },
                            fieldType: { type: 'STRING' },
                        },
                        required: ['value', 'xpath', 'templateName', 'pageNumber', 'fieldType'],
                    },
                },
            }
        );
        return JSON.parse(extractJsonText(result)) as XPathMapping[];
    } catch (error) {
        console.error('Gemini extractXPaths error:', error);
        throw error;
    }
};

export const generateDataMap = async (
    docxContent: string,
    xsdContent: string,
    templateName: string
): Promise<DataMappingResult> => {
    _accelerator = 'Data Mapping Generator';
    try {
        const result = await callGemini(
            getGeminiModel(),
            [{
                parts: [
                    { text: dataMappingGeneratorPrompt },
                    { text: `\n\n--- TEMPLATE NAME ---\n\n${templateName}` },
                    { text: `\n\n--- WORD DOCUMENT CONTENT (HTML) ---\n\n${docxContent}` },
                    { text: `\n\n--- XSD CONTENT ---\n\n${xsdContent}` },
                ],
            }],
            {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'OBJECT',
                    properties: {
                        mappings: {
                            type: 'ARRAY',
                            items: {
                                type: 'OBJECT',
                                properties: {
                                    field: { type: 'STRING' },
                                    xsdPath: { type: 'STRING' },
                                    sampleValue: { type: 'STRING' },
                                    templateName: { type: 'STRING' },
                                    pageNumber: { type: 'STRING' },
                                },
                                required: ['field', 'xsdPath', 'sampleValue', 'templateName', 'pageNumber'],
                            },
                        },
                        generatedXml: { type: 'STRING' },
                    },
                    required: ['mappings', 'generatedXml'],
                },
            }
        );
        return JSON.parse(extractJsonText(result)) as DataMappingResult;
    } catch (error) {
        console.error('Gemini generateDataMap error:', error);
        throw error;
    }
};

export const performSemanticComparison = async (
    textA: string,
    textB: string
): Promise<Array<{ textA: string; textB: string; reason: string; kind: 'diff' | 'same' }>> => {
    _accelerator = 'PDF Compare';
    try {
        const result = await callGemini(
            getGeminiModel(),
            [{
                parts: [
                    { text: semanticComparePrompt },
                    { text: `\n\n--- Page A ---\n\n${textA}` },
                    { text: `\n\n--- Page B ---\n\n${textB}` },
                ],
            }],
            {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'ARRAY',
                    items: {
                        type: 'OBJECT',
                        properties: {
                            textA: { type: 'STRING' },
                            textB: { type: 'STRING' },
                            reason: { type: 'STRING' },
                            kind: { type: 'STRING' },
                        },
                        required: ['textA', 'textB', 'reason', 'kind'],
                    },
                },
            }
        );
        return JSON.parse(extractJsonText(result));
    } catch (error) {
        console.error('Gemini performSemanticComparison error:', error);
        return [];
    }
};

const layoutRecommendationPrompt = `
You are a customer communications specialist. Analyze the provided customer communication document and reformat it into two concise versions.

Instructions:
1. EMAIL VERSION: A professional, condensed version optimized for email delivery.
   - Structure: Subject line (prefixed "Subject: "), then a blank line, then the body.
   - Body: 2â€“4 short paragraphs. Each paragraph separated by a blank line (\\n\\n).
   - Retain all key information â€” dates, action items, account/reference numbers, contact details.
   - Remove marketing filler and repetition. Keep a professional tone.
   - Use ONLY plain text. Separate paragraphs with two newline characters (\\n\\n). No markdown.

2. WHATSAPP VERSION: An ultra-condensed version for WhatsApp (5â€“7 lines maximum).
   - Include ONLY the most critical information: required action, key dates/deadlines, important reference numbers.
   - Plain language, short sentences. Each key point on its own line separated by a single newline (\\n).

Return a JSON object with exactly two keys:
- "emailVersion": the email text as described above, using \\n\\n between paragraphs
- "whatsappVersion": the WhatsApp text, using \\n between points
The entire response must be ONLY the JSON object.
`;

export const generateLayoutRecommendations = async (documentText: string): Promise<LayoutRecommendationResult> => {
    _accelerator = 'Layout Recommendation';
    try {
        const result = await callGemini(
            getGeminiModel(),
            [{ parts: [{ text: layoutRecommendationPrompt }, { text: `\n\n--- DOCUMENT CONTENT ---\n\n${documentText}` }] }],
            {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'OBJECT',
                    properties: {
                        emailVersion: { type: 'STRING' },
                        whatsappVersion: { type: 'STRING' },
                    },
                    required: ['emailVersion', 'whatsappVersion'],
                },
            }
        );
        return JSON.parse(extractJsonText(result)) as LayoutRecommendationResult;
    } catch (error) {
        console.error('Gemini generateLayoutRecommendations error:', error);
        throw error;
    }
};

const accessibilityPrompt = `Analyse the extracted PDF text below for WCAG 2.1 Level A and AA compliance. This is text-only analysis, so visual/programmatic checks (alt text, contrast, tagged structure) must be "warning". Return ONLY valid JSON — no markdown, nothing else:
{"overallScore":70,"grade":"C","summary":"The document has clear headings but missing language declaration and unverifiable alt text.","standards":[{"name":"WCAG 2.1","score":70,"criteria":[{"id":"1.1.1","standard":"WCAG 2.1","level":"A","name":"Non-text Content","status":"warning","severity":"major","issue":"Alt text cannot be verified from extracted text.","recommendation":"Open in Acrobat, run Accessibility Checker, add alt text to all images."},{"id":"1.3.1","standard":"WCAG 2.1","level":"A","name":"Info and Relationships","status":"pass"},{"id":"2.4.2","standard":"WCAG 2.1","level":"A","name":"Page Titled","status":"pass"},{"id":"2.4.4","standard":"WCAG 2.1","level":"A","name":"Link Purpose","status":"fail","severity":"major","issue":"Links use generic text like click here.","recommendation":"Use descriptive link text."},{"id":"3.1.1","standard":"WCAG 2.1","level":"A","name":"Language of Page","status":"warning","severity":"minor","issue":"Language not detectable.","recommendation":"Set document language in PDF Properties."}]}],"criticalIssues":0,"majorIssues":2,"minorIssues":1,"passed":4,"totalChecked":7}
Rules: grade A=90-100 B=75-89 C=60-74 D=40-59 F=0-39; status=pass/fail/warning; severity+issue+recommendation only for fail/warning; severity=critical/major/minor; evaluate 8-12 WCAG 2.1 criteria; output ONLY the JSON object.`;

function cleanJson(text: string): string {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return fenced[1].trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) return text.slice(start, end + 1);
    return text.trim();
}

export const scoreAccessibility = async (
    documentText: string,
    _fileName: string
): Promise<AccessibilityResult> => {
    _accelerator = 'Accessibility Scorer';
    try {
        const result = await callGemini(
            getGeminiModel(),
            [{
                parts: [
                    { text: accessibilityPrompt },
                    { text: `\n\n--- DOCUMENT TEXT ---\n\n${documentText}` },
                ],
            }],
            { responseMimeType: 'application/json' }
        );
        return JSON.parse(cleanJson(extractJsonText(result))) as AccessibilityResult;
    } catch (error) {
        console.error('Gemini scoreAccessibility error:', error);
        throw error;
    }
};

const businessRulesPrompt = `You are an expert business analyst specialising in document automation and COTS implementation. Analyse the provided document and extract ALL business rules. The document may be any type — a customer communication, letter, template, form specification, or BRD. Reviewer comments (marked "DOCUMENT REVIEWER COMMENTS") are equally valid sources of rules.

RECOGNISE IMPLICIT RULES — business rules appear in many forms beyond explicit specifications:
- Template placeholders such as <Field Name>, [Field], $x,xxx, MM/DD/YYYY indicate fields that have Validation or Presentation rules
- Comments labelled for a specific state, region, or segment indicate Conditional rules (e.g. a comment "Privacy Statement for NY" means: print this section only when customer state = NY)
- Date arithmetic visible in the text (e.g. dispatch date 10/18, receive-by 10/30 implies a 12-day SLA gap) indicates a Calculation rule
- Currency amounts, formatted dates, email addresses, phone numbers indicate Presentation rules

Extract exactly four rule types:
1. VALIDATION — a field is required/mandatory, must match a pattern, or must pass a business check. Example: "<Claim Adjustor Name> placeholder = mandatory field", "Claim amount must be positive".
2. CONDITIONAL — an element is shown, printed, suppressed, or populated only when a condition is met. Example: "Print NY Privacy Statement only when customer state = NY", "Show section only if claim type = Medical".
3. CALCULATION — a value is derived, computed, or results from arithmetic or a lookup. Example: "Receive-by Date = Dispatch Date + 12 calendar days", "Total = sum of line items".
4. PRESENTATION — how a field must be displayed or formatted (no validation error, purely display). Example: "Check Amount displayed as currency $X,XXX.XX", "Date formatted MM/DD/YYYY", "Email rendered as a hyperlink".

For each rule return:
- fieldName: descriptive name of the field, element, or document section (e.g. "Check Amount", "Dispatch Date", "Privacy Statement – NY", "Claim Adjustor Name")
- sourceReference: a short verbatim excerpt (up to 12 words) from the document that triggered this rule — the opening of the relevant line or sentence (e.g. "A final check for $x,xxx will be delivered", "If you do not receive the check by", "Privacy Statement for Newyork"); use "—" if no direct text source
- ruleType: exactly one of "Validation", "Conditional", "Calculation", "Presentation"
- condition: the trigger condition or constraint; empty string if the rule always applies
- actionFormula: what happens / how the value is computed or displayed
- errorMessage: error message on validation failure; empty string if not applicable
- dependentFields: comma-separated names of other fields this rule depends on; empty string if none
- priority: "High" (mandatory/blocking), "Medium" (important business rule), "Low" (cosmetic/advisory)
- pageReference: page or section reference (e.g. "Page 1", "Comments"); use "Page 1" if unknown

Priority guidance: High = mandatory fields, blocking validations. Medium = conditional sections, date calculations, format rules. Low = cosmetic hints.

Extract EVERY rule you can identify or reasonably infer from body text, placeholders, template variables, date arithmetic, and comments. Do NOT omit rules just because they are implicit. One entry per rule per field. Return ONLY valid JSON — no markdown.`;

export const extractBusinessRules = async (docText: string): Promise<BusinessRulesResult> => {
    _accelerator = 'Business Rules';
    try {
        const result = await callGemini(
            getGeminiModel(),
            [{ parts: [{ text: businessRulesPrompt }, { text: `\n\n--- DOCUMENT CONTENT ---\n\n${docText}` }] }],
            {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'OBJECT',
                    properties: {
                        rules: {
                            type: 'ARRAY',
                            items: {
                                type: 'OBJECT',
                                properties: {
                                    fieldName: { type: 'STRING' },
                                    sourceReference: { type: 'STRING' },
                                    ruleType: { type: 'STRING' },
                                    condition: { type: 'STRING' },
                                    actionFormula: { type: 'STRING' },
                                    errorMessage: { type: 'STRING' },
                                    dependentFields: { type: 'STRING' },
                                    priority: { type: 'STRING' },
                                    pageReference: { type: 'STRING' },
                                },
                                required: ['fieldName', 'ruleType', 'condition', 'actionFormula', 'errorMessage', 'dependentFields', 'priority'],
                            },
                        },
                    },
                    required: ['rules'],
                },
            }
        );
        return JSON.parse(extractJsonText(result)) as BusinessRulesResult;
    } catch (error) {
        console.error('Gemini extractBusinessRules error:', error);
        throw error;
    }
};

const testCasePrompt = `You are a senior QA engineer specialising in enterprise COTS implementation testing.

Given a set of extracted business rules, generate comprehensive test cases. Apply the following strategy per rule type:

VALIDATION rules → generate:
  • One happy-path test (valid, non-empty input that passes)
  • One mandatory-failure test (blank or null input)
  • One format or value violation test if a format or range is implied

CONDITIONAL rules → ALWAYS generate BOTH:
  • TRUE-branch test — condition is met; verify the expected outcome occurs
  • FALSE-branch test — condition is NOT met; verify the expected outcome does NOT occur

CALCULATION rules → generate:
  • One test with valid inputs producing the expected calculated result
  • One boundary test (zero, min, or max) where applicable

PRESENTATION rules → generate:
  • One test with a correctly formatted value
  • One test with an incorrectly formatted value

If ADDITIONAL HINTS are provided, generate extra test cases for every edge case, constraint, or scenario described there.

For each test case return:
- fieldSection: the field name or section from the business rule
- category: exactly one of "Happy Path", "Mandatory", "Boundary", "Conditional", "Format", "Calculation"
- testDescription: a clear one-line description of what is being tested
- inputData: the exact input value(s) — be specific (e.g. "(empty)", "State: NY", "$0.00", "31/02/2025", "invalid@email")
- expectedResult: what should happen (e.g. "Error: field is required", "NY Privacy Statement is displayed", "Receive-by Date = Dispatch Date + 12 days")
- priority: "High" (blocking/critical), "Medium" (important business logic), "Low" (advisory/cosmetic)
- preconditions: setup required before the test; use "None" if no setup needed
- testSteps: numbered step-by-step execution instructions, one step per line

Return ONLY valid JSON — no markdown, no explanation.`;

export const generateTestCases = async (rulesAndHints: string): Promise<TestCaseResult> => {
    _accelerator = 'Test Case Generator';
    try {
        const result = await callGemini(
            getGeminiModel(),
            [{ parts: [{ text: testCasePrompt }, { text: `\n\n${rulesAndHints}` }] }],
            {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'OBJECT',
                    properties: {
                        testCases: {
                            type: 'ARRAY',
                            items: {
                                type: 'OBJECT',
                                properties: {
                                    fieldSection:     { type: 'STRING' },
                                    category:         { type: 'STRING' },
                                    testDescription:  { type: 'STRING' },
                                    inputData:        { type: 'STRING' },
                                    expectedResult:   { type: 'STRING' },
                                    priority:         { type: 'STRING' },
                                    preconditions:    { type: 'STRING' },
                                    testSteps:        { type: 'STRING' },
                                },
                                required: ['fieldSection', 'category', 'testDescription', 'inputData', 'expectedResult', 'priority', 'preconditions', 'testSteps'],
                            },
                        },
                    },
                    required: ['testCases'],
                },
            }
        );
        return JSON.parse(extractJsonText(result)) as TestCaseResult;
    } catch (error) {
        console.error('Gemini generateTestCases error:', error);
        throw error;
    }
};

// Embeddings are computed client-side (no API call needed)
const generateKeywordEmbedding = (text: string): number[] => {
    const vector = new Array(768).fill(0);
    const words = text.toLowerCase().match(/\w+/g) || [];
    if (words.length === 0) return vector;
    words.forEach(word => {
        let hash = 0;
        for (let i = 0; i < word.length; i++) {
            hash = ((hash << 5) - hash) + word.charCodeAt(i);
            hash |= 0;
        }
        vector[Math.abs(hash) % 768] += 1;
    });
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return magnitude > 0 ? vector.map(v => v / magnitude) : vector;
};

export const embedContentBatch = async (textChunks: string[]): Promise<number[][]> => {
    return textChunks.map(chunk => generateKeywordEmbedding(chunk));
};
