
import React, { useState, useEffect, useRef } from 'react';
import SyntheticDataGenerator from './components/FieldExtractor';
import XPathExtractor from './components/XPathExtractor';
import DataMappingGenerator from './components/DataMappingGenerator';
import PdfCompare from './components/PdfCompare';
import PdfVisualCompare from './components/PdfVisualCompare';
import Rationalizer from './components/Rationalizer';
import { Squares2X2Icon } from './components/icons/Squares2X2Icon';
import { ArrowsRightLeftIcon } from './components/icons/ArrowsRightLeftIcon';
import { LinkIcon } from './components/icons/LinkIcon';
import { CodeBracketIcon } from './components/icons/CodeBracketIcon';
import { DocumentTextIcon } from './components/icons/DocumentTextIcon';
import { DevicePhoneMobileIcon } from './components/icons/DevicePhoneMobileIcon';
import ServerIcon from './components/icons/ServerIcon';
import HomeIcon from './components/icons/HomeIcon';
import LayoutRecommendation from './components/LayoutRecommendation';
import ApiDocs from './components/ApiDocs';
import Home from './components/Home';
import SettingsPage from './components/SettingsPage';
import Login from './components/Login';
import AccessibilityScorer from './components/AccessibilityScorer';
import { AccessibilityIcon } from './components/icons/AccessibilityIcon';
import BusinessRulesExtractor from './components/BusinessRulesExtractor';
import { ClipboardRulesIcon } from './components/icons/ClipboardRulesIcon';
import TestCaseGenerator from './components/TestCaseGenerator';
import TestCaseIcon from './components/icons/TestCaseIcon';
import LLMWarning from './components/LLMWarning';
import UserMenu from './components/UserMenu';
import HelpPage from './components/HelpPage';
import { useAuth } from './contexts/AuthContext';
import { useSettings } from './contexts/SettingsContext';
import type { Theme, LLMProvider } from './contexts/SettingsContext';

type Tool = 'home' | 'syntheticDataGenerator' | 'xpathExtractor' | 'dataMappingGenerator' | 'pdfCompare' | 'pdfVisualCompare' | 'rationalizer' | 'layoutRecommendation' | 'apiDocs' | 'accessibilityScorer' | 'businessRulesExtractor' | 'testCaseGenerator' | 'settings' | 'help';

interface NavItem {
  tool: Tool;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const GearIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
  </svg>
);

const LogoutIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15m-3 0-3-3m0 0 3-3m-3 3H15" />
  </svg>
);

const ACCELERATOR_TOOLS: Tool[] = [
  'rationalizer', 'pdfCompare', 'dataMappingGenerator',
  'xpathExtractor', 'syntheticDataGenerator', 'layoutRecommendation', 'accessibilityScorer',
  'businessRulesExtractor', 'testCaseGenerator',
];

const App: React.FC = () => {
  const { user, logout, isLoading } = useAuth();
  const { saveSettings } = useSettings();
  const [activeTool, setActiveTool] = useState<Tool>('home');
  const [filesToCompare, setFilesToCompare] = useState<[File, File] | null>(null);

  // Hydrate SettingsContext (and localStorage) from the user's DB preferences on login.
  // This ensures services that read from localStorage pick up the right keys.
  const hydratedUserId = useRef<number | null>(null);
  useEffect(() => {
    if (user && hydratedUserId.current !== user.id) {
      hydratedUserId.current = user.id;
      saveSettings({
        theme: user.theme as Theme,
        llmProvider: user.llmProvider as LLMProvider,
        geminiApiKey: user.geminiApiKey,
        claudeApiKey: user.claudeApiKey,
        openaiApiKey: user.openaiApiKey,
      });
    }
    if (!user) hydratedUserId.current = null;
  }, [user?.id]);

  const handleCompareRequest = (files: [File, File]) => {
    setFilesToCompare(files);
    setActiveTool('pdfCompare');
  };

  const handleCompareFilesConsumed = () => {
    setFilesToCompare(null);
  };

  const navItems: NavItem[] = [
    { tool: 'rationalizer', label: 'Rationalizer', description: 'Group similar PDFs', icon: <Squares2X2Icon className="w-5 h-5" /> },
    { tool: 'pdfCompare', label: 'PDF AI Compare', description: 'AI-powered semantic diff', icon: <ArrowsRightLeftIcon className="w-5 h-5" /> },
    {
      tool: 'pdfVisualCompare',
      label: 'PDF Visual Compare',
      description: 'Visual page diff, no AI',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    { tool: 'dataMappingGenerator', label: 'Data Mapping Generator', description: 'Map fields to XSD schema', icon: <LinkIcon className="w-5 h-5" /> },
    { tool: 'businessRulesExtractor', label: 'Business Rules', description: 'Extract rules from form specs', icon: <ClipboardRulesIcon className="w-5 h-5" /> },
    { tool: 'testCaseGenerator', label: 'Test Case Generator', description: 'Generate test suite from rules CSV', icon: <TestCaseIcon className="w-5 h-5" /> },
    { tool: 'xpathExtractor', label: 'XPath Extractor', description: 'Extract data to XML XPaths', icon: <CodeBracketIcon className="w-5 h-5" /> },
    { tool: 'syntheticDataGenerator', label: 'Synthetic Data Generation', description: 'Generate data from XSD', icon: <DocumentTextIcon className="w-5 h-5" /> },
    { tool: 'layoutRecommendation', label: 'Layout Recommendation', description: 'AI layout suggestions', icon: <DevicePhoneMobileIcon className="w-5 h-5" /> },
    { tool: 'accessibilityScorer', label: 'Accessibility Check', description: 'Score PDF accessibility compliance', icon: <AccessibilityIcon className="w-5 h-5" /> },
    { tool: 'apiDocs', label: 'APIs', description: 'REST API reference docs', icon: <ServerIcon className="w-5 h-5" /> },
  ];

  const activeItem = navItems.find(item => item.tool === activeTool) ?? null;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <svg className="w-8 h-8 text-indigo-400 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <div className="min-h-screen flex font-sans text-slate-800 dark:text-slate-200">
      {/* ── Left Sidebar ── */}
      <aside className="w-72 flex-shrink-0 flex flex-col bg-slate-900 dark:bg-slate-950 text-white h-screen sticky top-0">

        {/* Branding */}
        <div className="px-4 pt-6 pb-5 border-b border-slate-700">
          <button
            onClick={() => setActiveTool('home')}
            className="flex items-center gap-3 w-full text-left group"
            aria-label="Go to home"
          >
            <div className="w-10 h-10 rounded-xl bg-indigo-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-900/50 group-hover:bg-indigo-400 transition-colors">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1 1 .03 2.798-1.414 2.798H4.213c-1.444 0-2.414-1.798-1.414-2.798L4.8 15.3" />
              </svg>
            </div>
            <h1 className="text-lg font-extrabold text-white leading-snug group-hover:text-indigo-200 transition-colors">
              Document<br />
              <span className="whitespace-nowrap"><span className="text-amber-400 group-hover:text-amber-300 transition-colors">Intelligence</span> Hub</span>
            </h1>
          </button>
          <p className="mt-3 text-xs text-slate-400 leading-relaxed">
            AI-powered tools for customer communication management.
          </p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map(({ tool, label, description, icon }) => (
            <button
              key={tool}
              onClick={() => setActiveTool(tool)}
              className={`w-full flex items-start gap-3 px-3 py-3 rounded-lg text-left transition-all duration-150 group ${
                activeTool === tool
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/40'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
              aria-current={activeTool === tool ? 'page' : undefined}
            >
              <span className={`mt-0.5 flex-shrink-0 transition-colors ${activeTool === tool ? 'text-indigo-200' : 'text-slate-500 group-hover:text-indigo-400'}`}>
                {icon}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-tight">{label}</span>
                <span className={`block text-xs mt-0.5 leading-tight transition-colors ${activeTool === tool ? 'text-indigo-300' : 'text-slate-500 group-hover:text-slate-400'}`}>
                  {description}
                </span>
              </span>
            </button>
          ))}
        </nav>

        {/* Sidebar Footer — branding only */}
        <div className="px-4 py-3 border-t border-slate-700">
          <span className="text-xs text-slate-500">Designed by Deloitte</span>
        </div>
      </aside>

      {/* ── Fixed top-right user menu ── */}
      <div className="fixed top-3 right-4 z-40">
        <UserMenu
          user={user}
          onSettings={() => setActiveTool('settings')}
          onHelp={() => setActiveTool('help')}
          onLogout={logout}
        />
      </div>

      {/* ── Right Content Area ── */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-50 dark:bg-slate-900">

        {/* Content Header — shown for tools only (not home or settings) */}
        {activeItem && (
          <header className="flex-shrink-0 flex items-center gap-4 px-8 py-5 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400">
              {activeItem.icon}
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white leading-tight">
                {activeItem.label}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                {activeItem.description}
              </p>
            </div>
          </header>
        )}

        {/* Tool Content */}
        <main className="flex-1 overflow-y-auto p-6 md:p-8">
          {/* LLM warning — shown for all accelerator tools when no key is configured */}
          {ACCELERATOR_TOOLS.includes(activeTool) && (
            <LLMWarning onGoToSettings={() => setActiveTool('settings')} />
          )}

          <div className={activeTool === 'home' ? '' : 'hidden'}>
            <Home onNavigate={(tool) => setActiveTool(tool as Tool)} />
          </div>
          <div className={activeTool === 'rationalizer' ? '' : 'hidden'}>
            <Rationalizer onCompareRequest={handleCompareRequest} />
          </div>
          <div className={activeTool === 'pdfCompare' ? '' : 'hidden'}>
            <PdfCompare initialFiles={filesToCompare} onInitialFilesConsumed={handleCompareFilesConsumed} />
          </div>
          <div className={activeTool === 'pdfVisualCompare' ? '' : 'hidden'}>
            <PdfVisualCompare />
          </div>
          <div className={activeTool === 'dataMappingGenerator' ? '' : 'hidden'}>
            <DataMappingGenerator />
          </div>
          <div className={activeTool === 'xpathExtractor' ? '' : 'hidden'}>
            <XPathExtractor />
          </div>
          <div className={activeTool === 'syntheticDataGenerator' ? '' : 'hidden'}>
            <SyntheticDataGenerator />
          </div>
          <div className={activeTool === 'layoutRecommendation' ? '' : 'hidden'}>
            <LayoutRecommendation />
          </div>
          <div className={activeTool === 'accessibilityScorer' ? '' : 'hidden'}>
            <AccessibilityScorer />
          </div>
          <div className={activeTool === 'businessRulesExtractor' ? '' : 'hidden'}>
            <BusinessRulesExtractor />
          </div>
          <div className={activeTool === 'testCaseGenerator' ? '' : 'hidden'}>
            <TestCaseGenerator />
          </div>
          <div className={activeTool === 'apiDocs' ? '' : 'hidden'}>
            <ApiDocs />
          </div>
          {activeTool === 'settings' && <SettingsPage />}
          {activeTool === 'help' && <HelpPage />}
        </main>
      </div>
    </div>
  );
};

export default App;
