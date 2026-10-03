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

export interface BusinessRule {
    fieldName: string;
    ruleType: 'Validation' | 'Conditional' | 'Calculation' | 'Presentation';
    condition: string;
    actionFormula: string;
    errorMessage: string;
    dependentFields: string;
    priority: 'High' | 'Medium' | 'Low';
    sourceReference?: string;
    pageReference?: string;
}

export interface BusinessRulesResult {
    rules: BusinessRule[];
}

export interface TestCase {
    fieldSection: string;
    category: 'Happy Path' | 'Mandatory' | 'Boundary' | 'Conditional' | 'Format' | 'Calculation';
    testDescription: string;
    inputData: string;
    expectedResult: string;
    priority: 'High' | 'Medium' | 'Low';
    preconditions: string;
    testSteps: string;
}

export interface TestCaseResult {
    testCases: TestCase[];
}

export interface MockedXmlBundle {
    testCaseIds: string[];
    description: string;
    xmlContent: string;
}

export interface MockedXmlsResult {
    xmlBundles: MockedXmlBundle[];
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

// ── Company / Projects ────────────────────────────────────────────────────

export interface Company {
  id: number;
  name: string;
  storageProvider: 's3' | 'azure' | null;
  storageBucket: string;
  storageRegion: string;
  hasGeminiKey: boolean;
  hasClaudeKey: boolean;
  hasOpenAiKey: boolean;
  hasGrokKey: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyMember {
  id: number;
  username: string;
  role: 'Admin' | 'AppUser';
  companyRole: 'admin' | 'member';
  usesCompanyKeys: boolean;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  companyId: number;
  createdBy: number;
  status: 'active' | 'archived';
  visibility: 'private' | 'shared';
  createdAt: string;
  updatedAt: string;
  fileCount?: number;
}

export interface ProjectMember {
  userId: number;
  username: string;
  invitedBy: number;
  createdAt: string;
}

export interface ProjectFile {
  id: number;
  projectId: number;
  uploadedBy: number;
  name: string;
  fileType: string;
  role: 'template' | 'reference' | 'xsd' | 'csv' | 'archived';
  storageKey: string;
  signedUrl?: string;
  sizeBytes: number;
  archived: boolean;
  lifecycleStatus: 'original' | 'rationalized' | 'variation' | 'finalized';
  createdAt: string;
}

export interface ProjectResult {
  id: number;
  projectId: number;
  accelerator: string;
  resultData: any;
  provider: string | null;
  model: string | null;
  createdBy: number;
  createdAt: string;
}

export interface ProjectMessage {
  id: number;
  projectId: number;
  userId: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

// ── Final Inventory & Project Documents ───────────────────────────────────

export interface InventoryItem {
  id: number;
  projectId: number;
  fileId: number;
  fileName: string;
  fileType: string;
  groupId: number | null;
  variantCount: number;
  variations: { field: string; differences: string }[];
  businessDomain: string;
  status: 'pending' | 'in_progress' | 'done';
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDocument {
  id: number;
  projectId: number;
  docType: 'brd' | 'test_cases';
  content: any;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Template Analyser ──────────────────────────────────────────────────────

export interface RegulationCheck {
  name: string;
  status: 'compliant' | 'partial' | 'non-compliant' | 'not-applicable';
  accuracyScore: number;
  findings: string;
  recommendation: string;
}

export interface CompletenessAnalysis {
  score: number;
  presentElements: string[];
  missingElements: string[];
  recommendations: string[];
}

export interface SentimentAnalysis {
  overall: 'positive' | 'neutral' | 'negative';
  tone: string;
  readabilityScore: number;
  readabilityGrade: string;
  complexity: 'simple' | 'moderate' | 'complex';
  keyEmotions: string[];
}

export interface TemplateAnalysisResult {
  documentName: string;
  documentType: string;
  industry: string;
  purpose: string;
  targetAudience: string;
  channel: string;
  completeness: CompletenessAnalysis;
  regulations: RegulationCheck[];
  sentiment: SentimentAnalysis;
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  summary: string;
  keyFindings: string[];
  criticalIssues: string[];
}