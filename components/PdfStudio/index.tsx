import React, { useState } from 'react';
import TemplateList from './TemplateList';
import TemplateEditor from './TemplateEditor';
import ApiKeyManager from './ApiKeyManager';
import { PdfTemplate } from '../../types';

type View = 'list' | 'editor' | 'keys';

interface Props {
  onBack: () => void;
}

export default function PdfStudio({ onBack }: Props) {
  const [view, setView] = useState<View>('list');
  const [editTemplate, setEditTemplate] = useState<PdfTemplate | null>(null);

  function openNew() {
    setEditTemplate(null);
    setView('editor');
  }

  function openEdit(t: PdfTemplate) {
    setEditTemplate(t);
    setView('editor');
  }

  function backToList() {
    setEditTemplate(null);
    setView('list');
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50 dark:bg-slate-900">
      {/* Top nav */}
      <header className="flex items-center gap-4 px-6 py-3 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shadow-sm">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Hub
        </button>

        <div className="h-5 w-px bg-slate-200 dark:bg-slate-600" />

        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="font-semibold text-slate-800 dark:text-white">DocuComp</span>
        </div>

        <div className="flex-1" />

        <nav className="flex items-center gap-1">
          <NavBtn active={view === 'list' || view === 'editor'} onClick={() => backToList()}>Templates</NavBtn>
          <NavBtn active={view === 'keys'} onClick={() => setView('keys')}>API Keys</NavBtn>
        </nav>
      </header>

      {/* Body */}
      <main className="flex-1 overflow-auto">
        {view === 'list' && (
          <TemplateList onNew={openNew} onEdit={openEdit} />
        )}
        {view === 'editor' && (
          <TemplateEditor
            template={editTemplate}
            onSaved={backToList}
            onCancel={backToList}
          />
        )}
        {view === 'keys' && <ApiKeyManager />}
      </main>
    </div>
  );
}

function NavBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active
          ? 'bg-indigo-600 text-white'
          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  );
}
