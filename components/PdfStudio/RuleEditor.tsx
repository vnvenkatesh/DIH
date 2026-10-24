import React, { useState } from 'react';
import { PdfTemplateField, PdfTemplateRule } from '../../types';

interface Props {
  fields: PdfTemplateField[];
  rules: PdfTemplateRule[];
  onChange: (rules: PdfTemplateRule[]) => void;
}

type Operator = 'equals' | 'not_equals' | 'contains' | 'not_empty' | 'is_empty' | 'gt' | 'lt';

const OPERATORS: { value: Operator; label: string }[] = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'not_empty', label: 'is not empty' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'gt', label: 'greater than' },
  { value: 'lt', label: 'less than' },
];

const VALUE_LESS = new Set<Operator>(['not_empty', 'is_empty']);

export default function RuleEditor({ fields, rules, onChange }: Props) {
  const [form, setForm] = useState<Partial<PdfTemplateRule>>({
    rule_type: 'condition',
    rule_config: {},
  });
  const [addingNew, setAddingNew] = useState(false);

  function removeRule(index: number) {
    onChange(rules.filter((_, i) => i !== index));
  }

  function saveNew() {
    if (!form.block_id) return;
    const rule: PdfTemplateRule = {
      id: 0,
      template_id: 0,
      block_id: form.block_id,
      rule_type: form.rule_type as 'condition' | 'loop',
      rule_config: form.rule_config ?? {},
    };
    onChange([...rules, rule]);
    setForm({ rule_type: 'condition', rule_config: {} });
    setAddingNew(false);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Rules hide/show sections or loop over arrays. Blocks in the template must have a <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">data-block-id</code> attribute.
      </p>

      {rules.length === 0 && !addingNew && (
        <p className="text-sm text-slate-400 dark:text-slate-500 italic">No rules yet.</p>
      )}

      {rules.map((r, i) => (
        <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                r.rule_type === 'condition'
                  ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                  : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
              }`}>{r.rule_type}</span>
              <code className="text-xs font-mono text-slate-600 dark:text-slate-300">{r.block_id}</code>
            </div>
            {r.rule_type === 'condition' && r.rule_config.field && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                show when <strong>{r.rule_config.field}</strong> {OPERATORS.find(o => o.value === r.rule_config.operator)?.label ?? r.rule_config.operator}
                {!VALUE_LESS.has(r.rule_config.operator as Operator) && r.rule_config.value != null && (
                  <> "<strong>{String(r.rule_config.value)}</strong>"</>
                )}
              </p>
            )}
            {r.rule_type === 'loop' && r.rule_config.arrayField && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                repeat for each item in <strong>{r.rule_config.arrayField}</strong>
              </p>
            )}
          </div>
          <button
            onClick={() => removeRule(i)}
            className="text-slate-400 hover:text-red-500 dark:hover:text-red-400 flex-shrink-0"
            title="Remove"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}

      {addingNew && (
        <div className="p-4 rounded-lg border-2 border-dashed border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 w-24">Type</label>
            <select
              value={form.rule_type}
              onChange={e => setForm(f => ({ ...f, rule_type: e.target.value as 'condition' | 'loop', rule_config: {} }))}
              className="text-sm px-2 py-1 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
            >
              <option value="condition">Condition (show/hide)</option>
              <option value="loop">Loop (repeat)</option>
            </select>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 w-24">Block ID</label>
            <input
              value={form.block_id ?? ''}
              onChange={e => setForm(f => ({ ...f, block_id: e.target.value }))}
              placeholder="data-block-id value"
              className="flex-1 text-sm px-2 py-1 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white font-mono"
            />
          </div>

          {form.rule_type === 'condition' && (
            <>
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 w-24">Field</label>
                <select
                  value={form.rule_config?.field ?? ''}
                  onChange={e => setForm(f => ({ ...f, rule_config: { ...f.rule_config, field: e.target.value } }))}
                  className="flex-1 text-sm px-2 py-1 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                >
                  <option value="">— select field —</option>
                  {fields.map(f => <option key={f.field_name} value={f.field_name}>{f.field_name}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 w-24">Operator</label>
                <select
                  value={form.rule_config?.operator ?? 'equals'}
                  onChange={e => setForm(f => ({ ...f, rule_config: { ...f.rule_config, operator: e.target.value as Operator } }))}
                  className="flex-1 text-sm px-2 py-1 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                >
                  {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {!VALUE_LESS.has((form.rule_config?.operator ?? 'equals') as Operator) && (
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300 w-24">Value</label>
                  <input
                    value={String(form.rule_config?.value ?? '')}
                    onChange={e => setForm(f => ({ ...f, rule_config: { ...f.rule_config, value: e.target.value } }))}
                    placeholder="compare value"
                    className="flex-1 text-sm px-2 py-1 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                  />
                </div>
              )}
            </>
          )}

          {form.rule_type === 'loop' && (
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 w-24">Array field</label>
              <select
                value={form.rule_config?.arrayField ?? ''}
                onChange={e => setForm(f => ({ ...f, rule_config: { ...f.rule_config, arrayField: e.target.value } }))}
                className="flex-1 text-sm px-2 py-1 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
              >
                <option value="">— select array field —</option>
                {fields.filter(f => f.field_type === 'array').map(f => (
                  <option key={f.field_name} value={f.field_name}>{f.field_name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={saveNew}
              disabled={!form.block_id}
              className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              Add Rule
            </button>
            <button
              onClick={() => setAddingNew(false)}
              className="px-3 py-1.5 text-slate-600 dark:text-slate-300 rounded-lg text-sm hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!addingNew && (
        <button
          onClick={() => setAddingNew(true)}
          className="flex items-center gap-1.5 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors py-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add rule
        </button>
      )}
    </div>
  );
}
