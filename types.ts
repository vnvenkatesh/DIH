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
  highlightKind?: 'diff' | 'semantically-same' | 'added' | 'removed' | 'modified' | 'font' | 'pixel-diff';
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

export interface ClauseOccurrence {
    documentName: string;
    count: number; // how many times this clause appears in that document
}

export interface ClauseMatch {
    text: string;            // representative (first) clause text
    occurrences: ClauseOccurrence[];
    totalCount: number;      // total clause instances across all documents
    frequency: number;       // % of total input docs that contain this clause (0–100)
}

export interface LayoutRecommendationResult {
    emailVersion: string;
    whatsappVersion: string;
}

export interface AccessibilityCriterion {
  id: string;
  standard: string;
  level?: string;
  name: string;
  status: 'pass' | 'fail' | 'warning' | 'not-applicable';
  severity?: 'critical' | 'major' | 'minor';
  issue?: string;
  recommendation?: string;
}

export interface AccessibilityStandard {
  name: string;
  score: number;
  criteria: AccessibilityCriterion[];
}

export interface AccessibilityResult {
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  summary: string;
  standards: AccessibilityStandard[];
  criticalIssues: number;
  majorIssues: number;
  minorIssues: number;
  passed: number;
  totalChecked: number;
}