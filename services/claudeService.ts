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
You are an expert template designer and data architect. Your task is to map placeholder fields from a Word document template to the correct elements in an XML Schema Definition (XSD) and generate a valid sample XML.

Instructions:
1.  You will be provided with the text content of a Word document, the document's filename (Template Name), and the full text of an XSD file.
2.  Identify Dynamic Fields: Scan the Word document text for potential dynamic fields identified by patterns like <placeholder>, [placeholder], or common business terms.
3.  Strict Filtering: ONLY include fields explicitly identified in the Word document. Do NOT list all fields from the XSD.
4.  Analyze XSD Schema: Parse the provided XSD content to understand the schema structure.
5.  For each field identified in the Word document, determine the correct XPath to the corresponding leaf element within the XSD.
6.  Sample Data Priority:
    - Priority 1: If the Word document contains actual data next to a field, use that as the sampleValue.
    - Priority 2: If no data is found, generate a realistic synthetic sample value.
7.  Use the provided Template Name for the 'templateName' field. Estimate the 'pageNumber' where the field likely appears.
8.  Generate XML: Create a valid XML string that strictly conforms to the provided XSD. Populate with the sample data.
9.  Return a JSON object with two keys:
    - "mappings": An array of objects with "field", "xsdPath", "sampleValue", "templateName", and "pageNumber".
    - "generatedXml": A string containing the full, valid XML.
10. The entire response must be ONLY the JSON object. Do not include any other text, comments, or markdown formatting.
`;

const semanticComparePrompt = `
You are a meticulous quality assurance analyst. Your task is to compare two pages of a document and identify all semantic differences.

Instructions:
1. You will be given the text content of "Page A" and "Page B".
2. Analyze their meaning, intent, and the information they convey.
3. Ignore minor differences in wording or layout if the core meaning is identical.
4. Identify substantive differences in meaning, missing information, or added information.
5. For each semantic difference, provide:
    - "textA": The specific snippet from Page A that is different or missing in Page B. Use "" if entirely new in Page B.
    - "textB": The specific snippet from Page B that is different or missing in Page A. Use "" if removed from Page A.
    - "reason": A brief one-sentence explanation of the semantic difference.
6. Format the final output as a JSON array of objects.
7. The entire response must be ONLY the JSON array. Do not include any other text, comments, or markdown formatting.
`;

export const generateSyntheticDataFromXsd = async (xsdContent: string): Promise<SyntheticDataResult> => {
    const result = await callClaude({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8192,
        messages: [{ role: 'user', content: `${xsdToXmlPrompt}\n\n--- XML SCHEMA (XSD) ---\n\n${xsdContent}` }],
    });
    return JSON.parse(extractText(result)) as SyntheticDataResult;
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
    return JSON.parse(extractText(result)) as XPathMapping[];
};

export const generateDataMap = async (
    docxContent: string,
    xsdContent: string,
    templateName: string
): Promise<DataMappingResult> => {
    const result = await callClaude({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        messages: [{ role: 'user', content: `${dataMappingGeneratorPrompt}\n\n--- TEMPLATE NAME ---\n\n${templateName}\n\n--- WORD DOCUMENT CONTENT ---\n\n${docxContent}\n\n--- XSD CONTENT ---\n\n${xsdContent}` }],
    });
    return JSON.parse(extractText(result)) as DataMappingResult;
};

const layoutRecommendationPrompt = `
You are a customer communications specialist. Analyze the provided customer communication document and reformat it into two concise versions.

Instructions:
1. EMAIL VERSION:
   - Start with a subject line prefixed exactly "Subject: " on the first line, followed by a blank line.
   - Write 2–4 short paragraphs. Separate each paragraph with a blank line (i.e., use \\n\\n between paragraphs).
   - Retain all key information: important dates, action items, account/reference numbers, and contact details.
   - Plain text only — no markdown, no bullet symbols, no asterisks.
2. WHATSAPP VERSION:
   - 5–7 lines maximum.
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
    return JSON.parse(extractText(result)) as LayoutRecommendationResult;
};

export const performSemanticComparison = async (
    textA: string,
    textB: string
): Promise<Array<{ textA: string; textB: string; reason: string }>> => {
    try {
        const result = await callClaude({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 4096,
            messages: [{ role: 'user', content: `${semanticComparePrompt}\n\n--- Page A ---\n\n${textA}\n\n--- Page B ---\n\n${textB}` }],
        });
        return JSON.parse(extractText(result));
    } catch (error) {
        console.error('Error calling Claude API for semantic comparison:', error);
        return [];
    }
};

const accessibilityPrompt = `You are a certified digital accessibility expert. You have been given the extracted text content of a PDF document. Analyse it for accessibility compliance against WCAG 2.1 (A and AA), PDF/UA (ISO 14289-1), Section 508, and EN 301 549.

Because this analysis is based on extracted text rather than the raw PDF binary, apply these rules:
- Criteria that CAN be assessed from text: heading hierarchy, reading order, language indicators, link text quality, document title, table structure, list usage, paragraph flow, use of colour descriptions in text.
- Criteria that CANNOT be fully verified from text alone (e.g. tagged PDF structure, image alt text, contrast ratios, form labels) must be set to status "warning" with a note that manual PDF inspection is required.

You MUST return ONLY a single valid JSON object — no markdown fences, no explanatory text, nothing outside the JSON. Follow this example structure exactly (replace values with your real analysis):

{"overallScore":72,"grade":"C","summary":"The document has a clear heading hierarchy and good link descriptions, but several programmatic accessibility properties such as PDF tagging and image alt text require manual verification with a dedicated accessibility checker.","standards":[{"name":"WCAG 2.1","score":68,"criteria":[{"id":"1.1.1","standard":"WCAG 2.1","level":"A","name":"Non-text Content","status":"warning","severity":"major","issue":"Cannot confirm alt text for images from extracted text alone.","recommendation":"Open the PDF in Adobe Acrobat, run the Accessibility Checker, and add alt text to all informational images."},{"id":"1.3.1","standard":"WCAG 2.1","level":"A","name":"Info and Relationships","status":"pass"},{"id":"2.4.2","standard":"WCAG 2.1","level":"A","name":"Page Titled","status":"pass"},{"id":"2.4.4","standard":"WCAG 2.1","level":"A","name":"Link Purpose","status":"fail","severity":"major","issue":"Several links use generic text such as 'click here' or 'read more'.","recommendation":"Replace generic link text with descriptive text that identifies the link destination."},{"id":"3.1.1","standard":"WCAG 2.1","level":"A","name":"Language of Page","status":"warning","severity":"minor","issue":"No explicit language declaration detected in the extracted text.","recommendation":"Set the document language in PDF Properties > Description > Language."}]},{"name":"PDF/UA","score":65,"criteria":[{"id":"PDFUA-1","standard":"PDF/UA","name":"Tagged PDF","status":"warning","severity":"critical","issue":"Cannot confirm tagged PDF structure from extracted text.","recommendation":"Verify tagging using Acrobat's Accessibility Checker or PAC 2024."},{"id":"PDFUA-2","standard":"PDF/UA","name":"Logical Reading Order","status":"pass"},{"id":"PDFUA-3","standard":"PDF/UA","name":"Document Title","status":"warning","severity":"minor","issue":"Document metadata title could not be verified from content alone.","recommendation":"Set a descriptive title in File > Properties > Description."},{"id":"PDFUA-4","standard":"PDF/UA","name":"Bookmarks","status":"warning","severity":"minor","issue":"Navigation bookmarks cannot be confirmed from extracted text.","recommendation":"Add bookmarks for documents longer than a few pages."},{"id":"PDFUA-5","standard":"PDF/UA","name":"Heading Structure","status":"pass"}]},{"name":"Section 508","score":70,"criteria":[{"id":"508-1","standard":"Section 508","name":"Text Alternatives","status":"warning","severity":"major","issue":"Alt text for non-text elements requires manual verification.","recommendation":"Use Acrobat's Accessibility Checker to confirm all images have appropriate alt text."},{"id":"508-2","standard":"Section 508","name":"Adaptable Content","status":"pass"},{"id":"508-3","standard":"Section 508","name":"Distinguishable","status":"warning","severity":"major","issue":"Colour contrast cannot be assessed from extracted text.","recommendation":"Check all text/background colour combinations meet 4.5:1 ratio using a contrast analyser."},{"id":"508-4","standard":"Section 508","name":"Keyboard Navigation","status":"warning","severity":"minor","issue":"Tab order and focus indicators require interactive testing.","recommendation":"Test keyboard navigation using a screen reader such as NVDA or JAWS."},{"id":"508-5","standard":"Section 508","name":"Consistent Navigation","status":"pass"}]},{"name":"EN 301 549","score":72,"criteria":[{"id":"EN-9.1.1.1","standard":"EN 301 549","name":"Non-text Content","status":"warning","severity":"major","issue":"Alt text compliance requires verification in the source PDF.","recommendation":"Inspect the PDF with PAC 2024 or Acrobat to confirm alt text on all images."},{"id":"EN-9.1.3.1","standard":"EN 301 549","name":"Info and Relationships","status":"pass"},{"id":"EN-9.2.4.2","standard":"EN 301 549","name":"Page Titled","status":"pass"},{"id":"EN-9.3.1.1","standard":"EN 301 549","name":"Language of Page","status":"warning","severity":"minor","issue":"Language metadata requires verification.","recommendation":"Set document language in PDF properties."},{"id":"EN-9.4.1.2","standard":"EN 301 549","name":"Name, Role, Value","status":"warning","severity":"major","issue":"Programmatic name and role of form controls require interactive testing.","recommendation":"Use PAC 2024 to validate form field accessibility."}]}],"criticalIssues":0,"majorIssues":6,"minorIssues":4,"passed":8,"totalChecked":18}

Strict output rules:
- overallScore: integer 0-100
- grade: exactly one of "A","B","C","D","F" (A=90-100, B=75-89, C=60-74, D=40-59, F=0-39)
- standards: array with entries for WCAG 2.1, PDF/UA, Section 508, EN 301 549
- status: exactly one of "pass","fail","warning","not-applicable"
- Include "severity","issue","recommendation" ONLY when status is "fail" or "warning"
- severity: exactly one of "critical","major","minor"
- At least 5 criteria per standard
- Output ONLY the JSON object, nothing else`;

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
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        messages: [{
            role: 'user',
            content: `${accessibilityPrompt}\n\n--- DOCUMENT TEXT ---\n\n${documentText}`,
        }],
    });
    return JSON.parse(cleanJson(extractText(result))) as AccessibilityResult;
};
