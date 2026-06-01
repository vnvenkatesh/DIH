
import { XPathMapping, DataMappingResult, SyntheticDataResult, LayoutRecommendationResult } from '../types';
import { SETTINGS_STORAGE_KEY } from '../contexts/SettingsContext';

// In dev the Vite proxy forwards /api/gemini → googleapis.com, bypassing CORS.
// In production the full URL is used directly.
const GEMINI_API_BASE = import.meta.env.DEV
    ? '/api/gemini/models'
    : 'https://generativelanguage.googleapis.com/v1beta/models';

function getApiKey(): string {
    let apiKey: string | undefined;
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
        apiKey = s.geminiApiKey || process.env.API_KEY;
    } catch {
        apiKey = process.env.API_KEY;
    }
    if (!apiKey) throw new Error('Gemini API key not configured. Please add it in Settings.');
    return apiKey;
}

async function callGemini(model: string, contents: object[], generationConfig: object): Promise<any> {
    const apiKey = getApiKey();
    const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents, generationConfig }),
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error((err as any)?.error?.message || `Gemini API error ${resp.status}: ${resp.statusText}`);
    }

    return resp.json();
}

// Thinking models emit "thought" parts before the final output.
// This helper skips them and returns only the final text.
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
                            value: { type: 'STRING', description: 'The text value found in both the PDF and the XML.' },
                            xpath: { type: 'STRING', description: 'The full, absolute XPath to the element in the XML.' },
                            templateName: { type: 'STRING', description: 'The name of the template (PDF file).' },
                            pageNumber: { type: 'STRING', description: 'The estimated page number where the value appears.' },
                            fieldType: { type: 'STRING', description: 'The type of data (String, Date, Integer, etc.).' },
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
                                    field: { type: 'STRING', description: 'The placeholder name from the Word document.' },
                                    xsdPath: { type: 'STRING', description: 'The XPath to the corresponding element in the XSD.' },
                                    sampleValue: { type: 'STRING', description: 'The synthetic sample data for the field.' },
                                    templateName: { type: 'STRING', description: 'The name of the document template.' },
                                    pageNumber: { type: 'STRING', description: 'The estimated page number.' },
                                },
                                required: ['field', 'xsdPath', 'sampleValue', 'templateName', 'pageNumber'],
                            },
                        },
                        generatedXml: { type: 'STRING', description: 'The full, valid XML string.' },
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
                            textA: { type: 'STRING', description: 'The text snippet from Page A.' },
                            textB: { type: 'STRING', description: 'The text snippet from Page B.' },
                            reason: { type: 'STRING', description: 'Explanation of the semantic difference.' },
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
                        emailVersion: { type: 'STRING', description: 'The condensed email-friendly version.' },
                        whatsappVersion: { type: 'STRING', description: 'The ultra-condensed WhatsApp version.' },
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

// Embeddings are computed client-side to avoid external API dependency
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
