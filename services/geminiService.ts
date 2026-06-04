
import { XPathMapping, DataMappingResult, SyntheticDataResult, LayoutRecommendationResult, AccessibilityResult } from '../types';

const AUTH_KEY = 'dih_auth';

function getToken(): string {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || '{}').token || ''; }
    catch { return ''; }
}

async function callGemini(model: string, contents: object[], generationConfig: object): Promise<any> {
    const resp = await fetch('/v1/llm/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ model, contents, generationConfig }),
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
6.  Compile a list of all successful mappings.
7.  Format the final output as a JSON array of objects.
8.  The entire response must be ONLY the JSON array. Do not include any other text, comments, or markdown formatting.
`;

const dataMappingGeneratorPrompt = `
You are an expert template designer and data architect. Your task is to map placeholder fields from a Word document template to the correct elements in an XML Schema Definition (XSD) and generate a valid sample XML.

Instructions:
1.  You will be provided with the text content of a Word document, the document's filename (Template Name), and the full text of an XSD (XML Schema Definition) file.
2.  **Identify Dynamic Fields:** Scan the Word document text for potential dynamic fields. These will be identified by patterns like <placeholder>, [placeholder], or common business terms (e.g., "City", "Account Number", "Recipient Name").
3.  **Strict Filtering:** **ONLY** include fields that are explicitly identified in the Word document. Do **NOT** list all fields from the XSD schema.
4.  **Analyze XSD Schema:** Parse the provided XSD content to understand the schema structure. Look for 'xs:element', 'xs:complexType', and 'xs:attribute' definitions to identify the valid XML structure and paths.
5.  **AI-Powered Mapping:** For each field identified in the Word document, determine the correct XPath to the corresponding leaf element within the XSD schema.
6.  **Sample Data Priority:**
    - **Priority 1:** If the Word document contains actual data next to a field (e.g., "Name: John Smith"), use that data ("John Smith") as the 'sampleValue'.
    - **Priority 2:** If no data is found in the document for an identified field, generate a realistic, synthetic sample value based on the field name and XSD type.
7.  **Metadata:**
    - Use the provided Template Name for the 'templateName' field in the output.
    - Estimate the 'pageNumber' where the field likely appears based on the text flow.
8.  **Generate XML:** Create a valid XML string that strictly conforms to the provided XSD structure. Populate the elements corresponding to the mapped fields with the sample data. Ensure the XML is well-formed and valid against the schema.
9.  **Format the Output:** Return a JSON object with two keys:
    - "mappings": An array of objects, where each object contains "field", "xsdPath", "sampleValue", "templateName", and "pageNumber".
    - "generatedXml": A string containing the full, valid XML with the populated data.
10. The entire response must be ONLY the JSON object. Do not include any other text, comments, or markdown formatting.
`;

const semanticComparePrompt = `
You are a meticulous quality assurance analyst. Your task is to compare two pages of a document and identify all semantic differences.

Instructions:
1. You will be given the text content of "Page A" and "Page B".
2. Analyze their meaning, intent, and the information they convey.
3. Ignore minor differences in wording, phrasing, punctuation, or layout if the core meaning remains identical.
4. Identify substantive differences in meaning, missing information, or added information.
5. For each semantic difference, provide:
    - "textA": The specific snippet of text from Page A that is different or missing in Page B. Use an empty string if the content is entirely new in Page B.
    - "textB": The specific snippet of text from Page B that is different or missing in Page A. Use an empty string if the content was removed from Page A.
    - "reason": A brief, one-sentence explanation of the semantic difference.
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
5.  Format the final output as a JSON object with:
    - "fields": A JSON array of objects, where each object has a "field" key (the element/attribute name) and a "value" key (the generated synthetic value).
    - "generatedXml": A string containing the full, valid XML.
6.  The entire response must be ONLY the JSON object. Do not include any other text, comments, or markdown formatting.
`;

export const generateSyntheticDataFromXsd = async (xsdContent: string): Promise<SyntheticDataResult> => {
    try {
        const result = await callGemini(
            'gemini-2.5-flash',
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
    try {
        const result = await callGemini(
            'gemini-2.5-flash',
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
    try {
        const result = await callGemini(
            'gemini-2.5-flash',
            [{
                parts: [
                    { text: dataMappingGeneratorPrompt },
                    { text: `\n\n--- TEMPLATE NAME ---\n\n${templateName}` },
                    { text: `\n\n--- WORD DOCUMENT CONTENT ---\n\n${docxContent}` },
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
): Promise<Array<{ textA: string; textB: string; reason: string }>> => {
    try {
        const result = await callGemini(
            'gemini-2.5-flash',
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
                        },
                        required: ['textA', 'textB', 'reason'],
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
   - Body: 2–4 short paragraphs. Each paragraph separated by a blank line (\\n\\n).
   - Retain all key information — dates, action items, account/reference numbers, contact details.
   - Remove marketing filler and repetition. Keep a professional tone.
   - Use ONLY plain text. Separate paragraphs with two newline characters (\\n\\n). No markdown.

2. WHATSAPP VERSION: An ultra-condensed version for WhatsApp (5–7 lines maximum).
   - Include ONLY the most critical information: required action, key dates/deadlines, important reference numbers.
   - Plain language, short sentences. Each key point on its own line separated by a single newline (\\n).

Return a JSON object with exactly two keys:
- "emailVersion": the email text as described above, using \\n\\n between paragraphs
- "whatsappVersion": the WhatsApp text, using \\n between points
The entire response must be ONLY the JSON object.
`;

export const generateLayoutRecommendations = async (documentText: string): Promise<LayoutRecommendationResult> => {
    try {
        const result = await callGemini(
            'gemini-2.5-flash',
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

const accessibilityPrompt = `You are a certified digital accessibility expert. Analyze the provided PDF document and produce a detailed accessibility compliance report covering WCAG 2.1 (A and AA), PDF/UA (ISO 14289-1), Section 508, and EN 301 549.

For criteria you cannot directly verify from the document content, use status "warning" if they are commonly problematic for this document type, or "not-applicable" if genuinely irrelevant.

You MUST return ONLY a single valid JSON object — no markdown fences, no explanatory text, nothing outside the JSON. Follow this exact structure (the example values below are illustrative only — replace them with your real analysis):

{"overallScore":72,"grade":"C","summary":"The document has reasonable heading structure but lacks alternative text for several images and does not specify a document language, creating significant barriers for screen reader users.","standards":[{"name":"WCAG 2.1","score":68,"criteria":[{"id":"1.1.1","standard":"WCAG 2.1","level":"A","name":"Non-text Content","status":"fail","severity":"critical","issue":"Multiple images found without alternative text descriptions.","recommendation":"Add meaningful alt text to every informational image. Decorative images should be marked as artifacts."},{"id":"2.4.2","standard":"WCAG 2.1","level":"A","name":"Page Titled","status":"pass"},{"id":"1.4.3","standard":"WCAG 2.1","level":"AA","name":"Contrast (Minimum)","status":"warning","severity":"major","issue":"Light grey body text on white background may fall below the 4.5:1 contrast ratio required.","recommendation":"Verify contrast ratio with a tool such as the WebAIM Colour Contrast Checker and adjust text or background colour as needed."}]},{"name":"PDF/UA","score":"75","criteria":[{"id":"PDFUA-1","standard":"PDF/UA","name":"Tagged PDF","status":"warning","severity":"major","issue":"Unable to confirm the document contains full PDF tags from content alone.","recommendation":"Open the document in Adobe Acrobat and run the Accessibility Checker to verify and fix tag structure."}]},{"name":"Section 508","score":70,"criteria":[{"id":"508-1","standard":"Section 508","name":"Text Alternatives","status":"fail","severity":"critical","issue":"Non-text content lacks text alternatives.","recommendation":"Provide text alternatives for all non-text content."}]},{"name":"EN 301 549","score":72,"criteria":[{"id":"EN-9.1.1.1","standard":"EN 301 549","name":"Non-text Content","status":"fail","severity":"critical","issue":"Images without alt text violate clause 9.1.1.1.","recommendation":"Add alt text to all informational images."}]}],"criticalIssues":3,"majorIssues":2,"minorIssues":1,"passed":8,"totalChecked":14}

Strict rules for your output:
- overallScore: integer 0-100
- grade: exactly one of the strings "A","B","C","D","F" (A=90-100, B=75-89, C=60-74, D=40-59, F=0-39)
- standards: array with one entry per standard, covering all four: WCAG 2.1, PDF/UA, Section 508, EN 301 549
- Each criterion status must be exactly one of: "pass", "fail", "warning", "not-applicable"
- Only include "severity", "issue", and "recommendation" fields when status is "fail" or "warning"
- severity must be exactly one of: "critical", "major", "minor"
- Return at least 5 criteria per standard
- Output ONLY the JSON object`;

function cleanJson(text: string): string {
    // Strip markdown code fences if the model wrapped the output
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return fenced[1].trim();
    // Fallback: extract outermost { ... }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) return text.slice(start, end + 1);
    return text.trim();
}

export const scoreAccessibility = async (
    pdfBase64: string,
    pdfMimeType: string,
    _fileName: string
): Promise<AccessibilityResult> => {
    try {
        const result = await callGemini(
            'gemini-2.5-flash',
            [{
                parts: [
                    { text: accessibilityPrompt },
                    { inlineData: { mimeType: pdfMimeType || 'application/pdf', data: pdfBase64 } },
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
