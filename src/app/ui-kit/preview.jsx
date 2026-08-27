'use client';
import { createContext, useContext, useState } from 'react';
import kitUsage from './kit-usage.generated.json';
import kitProps from './kit-props.generated.json';
import { MapPin, Code2 } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// PREVIEW WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

// Opening the usage drawer is available to every preview without threading a
// callback through each section function.
export const KitContext = createContext({ openUsage: () => {} });

export function PreviewBlock({ title, description, children, filePath, component, fullWidth = false, dark = false }) {
  const [copied, setCopied] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const { openUsage } = useContext(KitContext);

  // All three are generated: the snippet is the preview's own JSX, the count is
  // the product's real usage, and the API is the component's own signature.
  // None of them is written next to the preview, so none can quietly stop being
  // true.
  const code = kitUsage.previews?.[title];
  const usageEntry = component ? kitUsage.components?.[component] : null;
  // A component the product reaches only through a host has no usage row, and
  // its drawer used to be unreachable — including the props table, which is the
  // part that does not depend on the product using it at all.
  const apiEntry = component ? kitProps.components?.[component] : null;

  const copyPath = () => {
    if (!filePath) return;
    navigator.clipboard.writeText(filePath);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex w-full flex-col items-start gap-3 sm:flex-row sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-[16px] font-bold text-[#1f1f1f]">{title}</h3>
          {description && <p className="text-[12px] text-[#9a9a9a] mt-[2px]">{description}</p>}
        </div>
        <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:shrink-0 sm:justify-end">
          {(usageEntry || apiEntry) && (
            <button
              onClick={() => openUsage(component)}
              title={
                usageEntry
                  ? `${component}: ${usageEntry.count} використань на ${usageEntry.routes.length} екранах`
                  : `${component}: пропси і призначення`
              }
              className="flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-[#e2e2e4] bg-[#f4f4f5] px-2.5 py-1 text-[11px] font-semibold text-[#71717a] transition-all hover:bg-[#e9e9e9] hover:text-[#18181b] active:scale-95"
            >
              <MapPin size={11} />
              {usageEntry ? (
                <>
                  <span className="font-mono">×{usageEntry.count}</span>
                  <span className="text-[#cfcfcf]">·</span>
                  <span>{usageEntry.routes.length} екранів</span>
                </>
              ) : (
                <span>{apiEntry.props.length} пропсів</span>
              )}
            </button>
          )}
          {code && (
            <button
              onClick={() => setShowCode(value => !value)}
              aria-pressed={showCode}
              title="Показати код цього preview"
              className={`flex cursor-pointer items-center gap-1.5 rounded-[6px] border px-2.5 py-1 text-[11px] font-mono font-semibold transition-all active:scale-95 ${
                showCode
                  ? 'border-[#1f1f1f] bg-[#1f1f1f] text-white'
                  : 'border-[#e2e2e4] bg-[#f4f4f5] text-[#71717a] hover:bg-[#e9e9e9] hover:text-[#18181b]'
              }`}
            >
              <Code2 size={11} />
              Код
            </button>
          )}
        {filePath && (
          <button
            onClick={copyPath}
            title={`Клацніть, щоб скопіювати шлях: ${filePath}`}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[#f4f4f5] hover:bg-[#e9e9e9] border border-[#e2e2e4] text-[#71717a] hover:text-[#18181b] text-[11px] font-mono transition-all font-semibold active:scale-95 shrink-0"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/>
              <path d="M6 6h10"/>
              <path d="M6 10h10"/>
            </svg>
            <span>{copied ? 'Скопійовано!' : filePath.split('/').pop()}</span>
          </button>
        )}
        </div>
      </div>
      <div className={`min-w-0 overflow-x-auto rounded-[16px] p-[12px] sm:p-[24px] ${dark ? 'bg-[#1f1f1f]' : 'bg-white border border-[#f0f0f0]'} ${fullWidth ? '' : 'flex flex-wrap items-center gap-[12px]'}`}>
        {children}
      </div>
      {showCode && code && (
        <pre className="overflow-x-auto rounded-[12px] bg-[#1f1f1f] p-[16px] text-[11px] leading-relaxed text-[#e4e4e7]">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

export function TokenChip({ label, value, isColor = false }) {
  return (
    <div className="flex items-center gap-[10px] bg-white rounded-[10px] px-[14px] py-[10px] border border-[#f0f0f0]">
      {isColor && <div className="w-[24px] h-[24px] rounded-[6px] shrink-0 border border-[#f0f0f0]" style={{ backgroundColor: value }} />}
      <div>
        <div className="text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wide">{label}</div>
        <div className="text-[13px] font-semibold text-[#1f1f1f] font-mono">{value}</div>
      </div>
    </div>
  );
}

// Status dot helper
export function StatusDot({ color }) {
  return <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ backgroundColor: color }} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
