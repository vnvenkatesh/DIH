
import React, { useState } from 'react';
import SyntheticDataGenerator from './components/FieldExtractor';
import XPathExtractor from './components/XPathExtractor';
import DataMappingGenerator from './components/DataMappingGenerator';
import PdfCompare from './components/PdfCompare';
import Rationalizer from './components/Rationalizer';
import { Squares2X2Icon } from './components/icons/Squares2X2Icon';
import { ArrowsRightLeftIcon } from './components/icons/ArrowsRightLeftIcon';
import { LinkIcon } from './components/icons/LinkIcon';
import { CodeBracketIcon } from './components/icons/CodeBracketIcon';
import { DocumentTextIcon } from './components/icons/DocumentTextIcon';
import { DevicePhoneMobileIcon } from './components/icons/DevicePhoneMobileIcon';
import ServerIcon from './components/icons/ServerIcon';
import HomeIcon from './components/icons/HomeIcon';
import SettingsPanel from './components/SettingsPanel';
import LayoutRecommendation from './components/LayoutRecommendation';
import ApiDocs from './components/ApiDocs';
import Home from './components/Home';

type Tool = 'home' | 'syntheticDataGenerator' | 'xpathExtractor' | 'dataMappingGenerator' | 'pdfCompare' | 'rationalizer' | 'layoutRecommendation' | 'apiDocs';

interface NavItem {
  tool: Tool;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const App: React.FC = () => {
  const [activeTool, setActiveTool] = useState<Tool>('home');
  const [filesToCompare, setFilesToCompare] = useState<[File, File] | null>(null);

  const handleCompareRequest = (files: [File, File]) => {
    setFilesToCompare(files);
    setActiveTool('pdfCompare');
  };

  const handleCompareFilesConsumed = () => {
    setFilesToCompare(null);
  };

  const navItems: NavItem[] = [
    { tool: 'rationalizer', label: 'Rationalizer', description: 'Group similar PDFs', icon: <Squares2X2Icon className="w-5 h-5" /> },
    { tool: 'pdfCompare', label: 'PDF Compare', description: 'Side-by-side semantic diff', icon: <ArrowsRightLeftIcon className="w-5 h-5" /> },
    { tool: 'dataMappingGenerator', label: 'Data Mapping Generator', description: 'Map fields to XSD schema', icon: <LinkIcon className="w-5 h-5" /> },
    { tool: 'xpathExtractor', label: 'XPath Extractor', description: 'Extract data to XML XPaths', icon: <CodeBracketIcon className="w-5 h-5" /> },
    { tool: 'syntheticDataGenerator', label: 'Synthetic Data Generation', description: 'Generate data from XSD', icon: <DocumentTextIcon className="w-5 h-5" /> },
    { tool: 'layoutRecommendation', label: 'Layout Recommendation', description: 'AI layout suggestions', icon: <DevicePhoneMobileIcon className="w-5 h-5" /> },
    { tool: 'apiDocs', label: 'APIs', description: 'REST API reference docs', icon: <ServerIcon className="w-5 h-5" /> },
  ];

  const activeItem = navItems.find(item => item.tool === activeTool) ?? null;

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

        {/* Sidebar Footer */}
        <div className="px-4 py-4 border-t border-slate-700 flex items-center justify-between">
          <span className="text-xs text-slate-500">Designed by Deloitte</span>
          <SettingsPanel />
        </div>
      </aside>

      {/* ── Right Content Area ── */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-50 dark:bg-slate-900">

        {/* Content Header — hidden on home page */}
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
          <div className={activeTool === 'home' ? '' : 'hidden'}>
            <Home onNavigate={(tool) => setActiveTool(tool as Tool)} />
          </div>
          <div className={activeTool === 'rationalizer' ? '' : 'hidden'}>
            <Rationalizer onCompareRequest={handleCompareRequest} />
          </div>
          <div className={activeTool === 'pdfCompare' ? '' : 'hidden'}>
            <PdfCompare initialFiles={filesToCompare} onInitialFilesConsumed={handleCompareFilesConsumed} />
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
          <div className={activeTool === 'apiDocs' ? '' : 'hidden'}>
            <ApiDocs />
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
