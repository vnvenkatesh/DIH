import { XPathMapping, DataMappingResult, SyntheticDataResult, LayoutRecommendationResult, AccessibilityResult, BusinessRulesResult, TestCaseResult } from '../types';

const AUTH_KEY = 'dih_auth';

let _accelerator = 'Other';

function getToken(): string {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || '{}').token || ''; }
    catch { return ''; }
}

async function callOpenAI(model: string, messages: any[], jsonMode = false): Promise<any> {
    const body: Record<string, any> = { model, messages, accelerator: _accelerator };
    if (jsonMode) body.response_format = { type: 'json_object' };

    const resp = await fetch('/v1/llm/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error((err as any)?.error?.message || (err as any)?.error || `OpenAI API error: ${resp.status}`);
    }
    return resp.json();
}

function extractText(response: any): string {
    const content = response?.choices?.[0]?.message?.content;
    if (!content) throw new Error('Unexpected OpenAI response format.');
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

const xPathExtractorPrompt = `
You are an expert document specialist tasked with mapping dynamic data from a PDF to its source XML.

Instructions:
1.  You will be given a PDF file, a Template Name, and its corresponding source XML file.
2.  Parse the XML to identify all text values (the content of the leaf nodes).
3.  For each text value from the XML, search for its presence in the PDF document.
4.  Use intelligent matching. For example, if the PDF has "Acme Corp." and the XML has "Acme Corporation," identify this as a match.
5.  For each identified match, determine:
    - The text value found in the PDF.
    - The full, absolute XPath of that element in the XML.
    - The estimated Page Number in the PDF where this value appears (e.g., "1").
    - The Data Type of the field based on the XML value (e.g., "String", "Date", "Currency", "Integer", "Boolean").
    - Use the provided Template Name for the 'templateName' field.
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
1. VALIDATION — a field is required/mandatory, must match a pattern, or must pass a business check. Example: "<Claim Adjustor Name> placeholder = mandatory field", "Claim amount must be positive".
2. CONDITIONAL — an element is shown, printed, suppressed, or populated only when a condition is met. Example: "Print NY Privacy Statement only when customer state = NY", "Show section only if claim type = Medical".
3. CALCULATION — a value is derived, computed, or results from arithmetic or a lookup. Example: "Receive-by Date = Dispatch Date + 12 calendar days", "Total = sum of line items".
4. PRESENTATION — how a field must be displayed or formatted (no validation error, purely display). Example: "Check Amount displayed as currency $X,XXX.XX", "Date formatted MM/DD/YYYY", "Email rendered as a hyperlink".

For each rule return a JSON object with exactly these keys:
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

Extract EVERY rule you can identify or reasonably infer from body text, placeholders, template variables, date arithmetic, and comments. Do NOT omit rules just because they are implicit. One entry per rule per field. Return ONLY a JSON object with a single key "rules" containing the array. No markdown.`;

export const extractBusinessRules = async (docText: string): Promise<BusinessRulesResult> => {
    _accelerator = 'Business Rules';
    const result = await callOpenAI(
        'gpt-4.1-mini',
        [{ role: 'user', content: `${businessRulesPrompt}\n\n--- DOCUMENT CONTENT ---\n\n${docText}` }],
        true
    );
    return JSON.parse(cleanJson(extractText(result))) as BusinessRulesResult;
};

const accessibilityPrompt = `Analyse the extracted PDF text below for WCAG 2.1 Level A and AA compliance. This is text-only analysis, so visual/programmatic checks (alt text, contrast, tagged structure) must be "warning". Return ONLY valid JSON — no markdown, nothing else:
{"overallScore":70,"grade":"C","summary":"The document has clear headings but missing language declaration and unverifiable alt text.","standards":[{"name":"WCAG 2.1","score":70,"criteria":[{"id":"1.1.1","standard":"WCAG 2.1","level":"A","name":"Non-text Content","status":"warning","severity":"major","issue":"Alt text cannot be verified from extracted text.","recommendation":"Open in Acrobat, run Accessibility Checker, add alt text to all images."},{"id":"1.3.1","standard":"WCAG 2.1","level":"A","name":"Info and Relationships","status":"pass"},{"id":"2.4.2","standard":"WCAG 2.1","level":"A","name":"Page Titled","status":"pass"},{"id":"2.4.4","standard":"WCAG 2.1","level":"A","name":"Link Purpose","status":"fail","severity":"major","issue":"Links use generic text like click here.","recommendation":"Use descriptive link text."},{"id":"3.1.1","standard":"WCAG 2.1","level":"A","name":"Language of Page","status":"warning","severity":"minor","issue":"Language not detectable.","recommendation":"Set document language in PDF Properties."}]}],"criticalIssues":0,"majorIssues":2,"minorIssues":1,"passed":4,"totalChecked":7}
Rules: grade A=90-100 B=75-89 C=60-74 D=40-59 F=0-39; status=pass/fail/warning; severity+issue+recommendation only for fail/warning; severity=critical/major/minor; evaluate 8-12 WCAG 2.1 criteria; output ONLY the JSON object.`;

export const generateSyntheticDataFromXsd = async (xsdContent: string): Promise<SyntheticDataResult> => {
    _accelerator = 'Synthetic Data Generator';
    const result = await callOpenAI(
        'gpt-4.1-mini',
        [{ role: 'user', content: `${xsdToXmlPrompt}\n\n--- XML SCHEMA (XSD) ---\n\n${xsdContent}` }],
        true
    );
    return JSON.parse(cleanJson(extractText(result))) as SyntheticDataResult;
};

export const extractXPaths = async (
    pdfBase64: string,
    _pdfMimeType: string,
    xmlContent: string,
    templateName: string
): Promise<XPathMapping[]> => {
    _accelerator = 'XPath Extractor';
    const result = await callOpenAI(
        'gpt-4.1',
        [{
            role: 'user',
            content: [
                { type: 'text', text: `${xPathExtractorPrompt}\n\n--- TEMPLATE NAME ---\n\n${templateName}` },
                { type: 'file', file: { filename: 'document.pdf', file_data: `data:application/pdf;base64,${pdfBase64}` } },
                { type: 'text', text: `\n\n--- XML CONTENT ---\n\n${xmlContent}` },
            ],
        }]
    );
    return JSON.parse(cleanJsonArray(extractText(result))) as XPathMapping[];
};

export const generateDataMap = async (
    docxContent: string,
    xsdContent: string,
    templateName: string
): Promise<DataMappingResult> => {
    _accelerator = 'Data Mapping Generator';
    const result = await callOpenAI(
        'gpt-4.1',
        [{ role: 'user', content: `${dataMappingGeneratorPrompt}\n\n--- TEMPLATE NAME ---\n\n${templateName}\n\n--- WORD DOCUMENT CONTENT (HTML) ---\n\n${docxContent}\n\n--- XSD CONTENT ---\n\n${xsdContent}` }],
        true
    );
    return JSON.parse(cleanJson(extractText(result))) as DataMappingResult;
};

export const performSemanticComparison = async (
    textA: string,
    textB: string
): Promise<Array<{ textA: string; textB: string; reason: string; kind: 'diff' | 'same' }>> => {
    _accelerator = 'PDF Compare';
    try {
        const result = await callOpenAI(
            'gpt-4.1-mini',
            [{ role: 'user', content: `${semanticComparePrompt}\n\n--- Page A ---\n\n${textA}\n\n--- Page B ---\n\n${textB}` }]
        );
        return JSON.parse(cleanJsonArray(extractText(result)));
    } catch (error) {
        console.error('Error calling OpenAI API for semantic comparison:', error);
        return [];
    }
};

export const generateLayoutRecommendations = async (documentText: string): Promise<LayoutRecommendationResult> => {
    _accelerator = 'Layout Recommendation';
    const result = await callOpenAI(
        'gpt-4.1-mini',
        [{ role: 'user', content: `${layoutRecommendationPrompt}\n\n--- DOCUMENT CONTENT ---\n\n${documentText}` }],
        true
    );
    return JSON.parse(cleanJson(extractText(result))) as LayoutRecommendationResult;
};

export const scoreAccessibility = async (
    documentText: string,
    _fileName: string
): Promise<AccessibilityResult> => {
    _accelerator = 'Accessibility Scorer';
    const result = await callOpenAI(
        'gpt-4.1-mini',
        [{ role: 'user', content: `${accessibilityPrompt}\n\n--- DOCUMENT TEXT ---\n\n${documentText}` }],
        true
    );
    return JSON.parse(cleanJson(extractText(result))) as AccessibilityResult;
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

Return ONLY a JSON object with a single key "testCases" containing the array. No markdown.`;

export const generateTestCases = async (rulesAndHints: string): Promise<TestCaseResult> => {
    _accelerator = 'Test Case Generator';
    const result = await callOpenAI(
        'gpt-4.1-mini',
        [{ role: 'user', content: `${testCasePrompt}\n\n${rulesAndHints}` }],
        true
    );
    return JSON.parse(cleanJson(extractText(result))) as TestCaseResult;
};
