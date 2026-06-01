import React from 'react';

interface ToggleSwitchProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  leftLabel: string;
  rightLabel: string;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ enabled, onChange, leftLabel, rightLabel }) => {
  return (
    <div className="flex items-center justify-center">
      <span className={`mr-3 text-sm font-medium ${!enabled ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`}>
        {leftLabel}
      </span>
      <label className="relative inline-flex items-center cursor-pointer">
        <input 
          type="checkbox" 
          checked={enabled}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer" 
        />
        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-indigo-600"></div>
      </label>
      <span className={`ml-3 text-sm font-medium ${enabled ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`}>
        {rightLabel}
      </span>
    </div>
  );
};

export default ToggleSwitch;
