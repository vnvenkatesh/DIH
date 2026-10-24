import React from 'react';
import { PdfTemplateField } from '../../types';

interface Props {
  fields: PdfTemplateField[];
  onChange: (fields: PdfTemplateField[]) => void;
}

const FIELD_TYPES: PdfTemplateField['field_type'][] = ['string', 'number', 'date', 'boolean', 'array', 'object'];

export default function SchemaEditor({ fields, onChange }: Props) {
  function update(index: number, patch: Partial<PdfTemplateField>) {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function remove(index: number) {
    onChange(fields.filter((_, i) => i !== index));
  }

  function addField() {
    const newField: PdfTemplateField = {
      id: 0,
      template_id: 0,
      field_name: '',
      field_type: 'string',
      is_required: false,
      default_value: '',
      description: '',
      parent_field: null,
      sort_order: fields.length,
    };
    onChange([...fields, newField]);
  }

  if (fields.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400 dark:text-slate-500 text-sm">
        <p>No fields detected. Add fields manually or re-scan the template for placeholders.</p>
        <button
          onClick={addField}
          className="mt-3 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700"
        >
          Add Field
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="hidden sm:grid grid-cols-[1fr_100px_80px_1fr_28px] gap-2 px-2 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
        <span>Field Name</span>
        <span>Type</span>
        <span>Required</span>
        <span>Default / Description</span>
        <span />
      </div>

      {fields.map((f, i) => (
        <div
          key={i}
          className="grid grid-cols-1 sm:grid-cols-[1fr_100px_80px_1fr_28px] gap-2 items-center p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
        >
          <input
            value={f.field_name}
            onChange={e => update(i, { field_name: e.target.value })}
            placeholder="field.name"
            className="w-full text-sm px-2 py-1 rounded border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white font-mono"
          />
          <select
            value={f.field_type}
            onChange={e => update(i, { field_type: e.target.value as PdfTemplateField['field_type'] })}
            className="text-sm px-2 py-1 rounded border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white"
          >
            {FIELD_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={f.is_required}
              onChange={e => update(i, { is_required: e.target.checked })}
              className="rounded accent-indigo-600"
            />
            Required
          </label>
          <input
            value={f.default_value || f.description || ''}
            onChange={e => update(i, { default_value: e.target.value })}
            placeholder="default value or description"
            className="w-full text-sm px-2 py-1 rounded border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white"
          />
          <button
            onClick={() => remove(i)}
            className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-red-500 dark:hover:text-red-400 rounded transition-colors"
            title="Remove field"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}

      <button
        onClick={addField}
        className="flex items-center gap-1.5 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors py-1"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add field
      </button>
    </div>
  );
}
