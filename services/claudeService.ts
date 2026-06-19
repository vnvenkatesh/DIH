import { XPathMapping, DataMappingResult, SyntheticDataResult, LayoutRecommendationResult, AccessibilityResult } from '../types';

const AUTH_KEY = 'dih_auth';

function getToken(): string {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || '{}').token || ''; }
    catch { return ''; }
}

async function callClaude(payload: { model: string; max_tokens: number; messages: any[] }, extraHeaders: Record<string, string> = {}): Promise<any> {
    const body: Record<string, any> = {
        model: payload.model,
        max_tokens: payload.max_tokens,
        messages: payload.messages,
    };
    if (extraHeaders['anthropic-beta']) body.beta = extraHeaders['anthropic-beta'];

    const resp = await fetch('/v1/llm/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error((err as any)?.error?.message || (err as any)?.error || `Claude API error: ${resp.status}`);
    }
    return resp.json();
}

function extractText(response: any): string {
    const block = response?.content?.[0];
    if (!block || block.type !== 'text') throw new Error('Unexpected Claude response format.');
    return block.text.trim();
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
5.  Format the final output as a JSON object with:
    - "fields": A JSON array of objects, where each object has a "field" key (the element/attribute name) and a "value" key (the generated synthetic value).
    - "generatedXml": A string containing the full, valid XML.
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
6.  Compile a list of all successful mappings.
7.  Format the final output as a JSON array of objects.
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

export const generateSyntheticDataFromXsd = async (xsdContent: string): Promise<SyntheticDataResult> => {
    const result = await callClaude({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8192,
        messages: [{ role: 'user', content: `${xsdToXmlPrompt}\n\n--- XML SCHEMA (XSD) ---\n\n${xsdContent}` }],
    });
    return JSON.parse(cleanJson(extractText(result))) as SyntheticDataResult;
};

export const extractXPaths = async (
    pdfBase64: string,
    _pdfMimeType: string,
    xmlContent: string,
    templateName: string
): Promise<XPathMapping[]> => {
    const result = await callClaude({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        messages: [{
            role: 'user',
            content: [
                { type: 'text', text: `${xPathExtractorPrompt}\n\n--- TEMPLATE NAME ---\n\n${templateName}` },
                { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
                { type: 'text', text: `\n\n--- XML CONTENT ---\n\n${xmlContent}` },
            ],
        }],
    }, { 'anthropic-beta': 'pdfs-2024-09-25' });
    return JSON.parse(cleanJson(extractText(result))) as XPathMapping[];
};

export const generateDataMap = async (
    docxContent: string,
    xsdContent: string,
    templateName: string
): Promise<DataMappingResult> => {
    const result = await callClaude({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        messages: [{ role: 'user', content: `${dataMappingGeneratorPrompt}\n\n--- TEMPLATE NAME ---\n\n${templateName}\n\n--- WORD DOCUMENT CONTENT (HTML) ---\n\n${docxContent}\n\n--- XSD CONTENT ---\n\n${xsdContent}` }],
    });
    return JSON.parse(cleanJson(extractText(result))) as DataMappingResult;
};

const layoutRecommendationPrompt = `
You are a customer communications specialist. Analyze the provided customer communication document and reformat it into two concise versions.

Instructions:
1. EMAIL VERSION:
   - Start with a subject line prefixed exactly "Subject: " on the first line, followed by a blank line.
   - Write 2â€“4 short paragraphs. Separate each paragraph with a blank line (i.e., use \\n\\n between paragraphs).
   - Retain all key information: important dates, action items, account/reference numbers, and contact details.
   - Plain text only â€” no markdown, no bullet symbols, no asterisks.
2. WHATSAPP VERSION:
   - 5â€“7 lines maximum.
   - Each point on its own line separated by \\n.
   - Include ONLY the most critical information: what the customer needs to do, key dates or deadlines, and any important reference numbers.
   - Plain language, short sentences.

Return a JSON object with exactly two keys:
- "emailVersion": the complete email-optimised text as a plain string (paragraphs separated by \\n\\n)
- "whatsappVersion": the ultra-condensed WhatsApp-ready text as a plain string (lines separated by \\n)
The entire response must be ONLY the JSON object.
`;

export const generateLayoutRecommendations = async (documentText: string): Promise<LayoutRecommendationResult> => {
    const result = await callClaude({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{ role: 'user', content: `${layoutRecommendationPrompt}\n\n--- DOCUMENT CONTENT ---\n\n${documentText}` }],
    });
    return JSON.parse(cleanJson(extractText(result))) as LayoutRecommendationResult;
};

export const performSemanticComparison = async (
    textA: string,
    textB: string
): Promise<Array<{ textA: string; textB: string; reason: string; kind: 'diff' | 'same' }>> => {
    try {
        const result = await callClaude({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 4096,
            messages: [{ role: 'user', content: `${semanticComparePrompt}\n\n--- Page A ---\n\n${textA}\n\n--- Page B ---\n\n${textB}` }],
        });
        return JSON.parse(cleanJson(extractText(result)));
    } catch (error) {
        console.error('Error calling Claude API for semantic comparison:', error);
        return [];
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
    const result = await callClaude({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8192,
        messages: [{
            role: 'user',
            content: `${accessibilityPrompt}\n\n--- DOCUMENT TEXT ---\n\n${documentText}`,
        }],
    });
    return JSON.parse(cleanJson(extractText(result))) as AccessibilityResult;
};
