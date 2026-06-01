import React from 'react';

export interface FormField {
  field: string;
  value: string;
}

export interface SyntheticDataResult {
    fields: FormField[];
    generatedXml?: string;
}

export interface XPathMapping {
  value: string;
  xpath: string;
  templateName: string;
  pageNumber: string;
  fieldType: string;
}

export interface DataMapping {
  field: string;
  xsdPath: string;
  sampleValue: string;
  templateName: string;
  pageNumber: string;
}

export interface DataMappingResult {
  mappings: DataMapping[];
  generatedXml: string;
}

export interface ConsolidatedDataMapping {
  field: string;
  xsdPath: string;
  sampleValue: string;
  templateCount: number;
  templates: string[];
}

export interface Highlight {
  bbox: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  tooltipContent: React.ReactNode;
}

export interface ComparisonDifference {
  page: number;
  highlightsA: Highlight[];
  highlightsB: Highlight[];
}

export interface ProcessedDocument {
    file: File;
    text: string;
    hash?: string;
    embedding?: number[];
    thumbnail?: string;
}

export interface DocumentGroup {
    id: number;
    documents: ProcessedDocument[];
    similarity: number;
}

export interface LayoutRecommendationResult {
    emailVersion: string;
    whatsappVersion: string;
}