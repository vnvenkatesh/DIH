import * as gemini from './geminiService';
import * as claude from './claudeService';
import { XPathMapping, DataMappingResult, SyntheticDataResult, LayoutRecommendationResult, AccessibilityResult } from '../types';
import { SETTINGS_STORAGE_KEY } from '../contexts/SettingsContext';

function getProvider(): 'claude' | 'gemini' {
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
        return s.llmProvider === 'claude' ? 'claude' : 'gemini';
    } catch {
        return 'gemini';
    }
}

export const generateSyntheticDataFromXsd = (xsdContent: string): Promise<SyntheticDataResult> =>
    getProvider() === 'claude'
        ? claude.generateSyntheticDataFromXsd(xsdContent)
        : gemini.generateSyntheticDataFromXsd(xsdContent);

export const extractXPaths = (
    pdfBase64: string,
    pdfMimeType: string,
    xmlContent: string,
    templateName: string
): Promise<XPathMapping[]> =>
    getProvider() === 'claude'
        ? claude.extractXPaths(pdfBase64, pdfMimeType, xmlContent, templateName)
        : gemini.extractXPaths(pdfBase64, pdfMimeType, xmlContent, templateName);

export const generateDataMap = (
    docxContent: string,
    xsdContent: string,
    templateName: string
): Promise<DataMappingResult> =>
    getProvider() === 'claude'
        ? claude.generateDataMap(docxContent, xsdContent, templateName)
        : gemini.generateDataMap(docxContent, xsdContent, templateName);

export const performSemanticComparison = (
    textA: string,
    textB: string
): Promise<Array<{ textA: string; textB: string; reason: string }>> =>
    getProvider() === 'claude'
        ? claude.performSemanticComparison(textA, textB)
        : gemini.performSemanticComparison(textA, textB);

export const generateLayoutRecommendations = (documentText: string): Promise<LayoutRecommendationResult> =>
    getProvider() === 'claude'
        ? claude.generateLayoutRecommendations(documentText)
        : gemini.generateLayoutRecommendations(documentText);

export const scoreAccessibility = (
    documentText: string,
    fileName: string
): Promise<AccessibilityResult> =>
    getProvider() === 'claude'
        ? claude.scoreAccessibility(documentText, fileName)
        : gemini.scoreAccessibility(documentText, fileName);

// Embeddings are always computed client-side
export const embedContentBatch = gemini.embedContentBatch;
