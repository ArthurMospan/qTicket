'use client';

// What a component is, how to call it, and where it already lives — opened from
// its own preview.
//
// This used to be a separate screen, which meant leaving the component you were
// looking at to go read a table about it. The question is always asked *at* the
// preview — "where is this on the site?" — so the answer belongs there too.
//
// Everything is read from two generated files. kit-usage.generated.json
// (`npm run kit:scan`) has the per-variant counts, the screens each variant
// appears on, and the exact file:line list. kit-props.generated.json
// (`npm run kit:props`) has the API: the component's own destructured props,
// their defaults, the values the variant manifest declares for them, and the
// description from its JSDoc. Nothing here is hand-maintained.

import { ExternalLink, X } from 'lucide-react';
import { useModalFocus } from '@/lib/hooks/useModalFocus';
import usage from './kit-usage.generated.json';
import propsReport from './kit-props.generated.json';

// A dynamic segment has no real id to link to, so the parent screen plus the
// next step is offered instead of a dead URL.
const DYNAMIC_ROUTES = {
  '/[projectId]': { href: '/', hint: 'відкрий проєкт' },
  '/[projectId]/issue/[issueId]': { href: '/', hint: 'проєкт → задача' },
  '/[projectId]/portal': { href: '/', hint: 'проєкт → портал' },
  '/analytics/team/[memberId]': { href: '/analytics', hint: 'аналітика → учасник' },
  '/calendar/event/[eventId]': { href: '/calendar', hint: 'календар → подія' },
};

function RouteLink({ route }) {
  const dynamic = DYNAMIC_ROUTES[route];
  return (
    <a
      href={dynamic ? dynamic.href : route}
      target="_blank"
      rel="noreferrer"
      title={dynamic ? `${route} — ${dynamic.hint}` : `Відкрити ${route}`}
      className="inline-flex items-center gap-1 rounded-[6px] bg-[#f4f4f5] px-[6px] py-[2px] font-mono text-[10px] font-semibold text-[#1f1f1f] transition-colors hover:bg-[#1f1f1f] hover:text-white"
    >
      {route}
      <ExternalLink size={9} />
    </a>
  );
}

// One row of the API table. The default is printed as source text, so
// `size = 'lg'` reads here exactly as it reads in the component.
function PropRow({ prop }) {
  return (
    <div className="rounded-[8px] border border-[#f0f0f0] px-[10px] py-[7px]">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-[11px] font-bold text-[#1f1f1f]">{prop.name}</span>
        {prop.type && <span className="font-mono text-[10px] text-[#a1a1aa]">{prop.type}</span>}
        {prop.default && (
          <span className="ml-auto shrink-0 rounded-[5px] bg-[#f4f4f5] px-[6px] py-[1px] font-mono text-[10px] text-[#71717a]">
            = {prop.default}
          </span>
        )}
      </div>
      {prop.description && (
        <p className="mt-[3px] text-[11px] leading-relaxed text-[#71717a]">{prop.description}</p>
      )}
      {prop.values.length > 0 && (
        <div className="mt-[5px] flex flex-wrap gap-[3px]">
          {prop.values.map(value => (
            <span key={value} className="rounded-[4px] bg-[#fafafa] px-[5px] py-[1px] font-mono text-[9px] text-[#71717a]">
              {value}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function UsagePanel({ component, onClose }) {
  const dialogRef = useModalFocus({ isOpen: Boolean(component), onClose });

  if (!component) return null;

  const entry = usage.components[component];
  const variants = usage.variants?.[component] || {};
  const api = propsReport.components[component];

  return (
    <>
      <button
        type="button"
        aria-label="Закрити"
        onClick={onClose}
        className="fixed inset-0 z-[80] cursor-default bg-black/20"
      />
      <aside
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-label={`Де використовується ${component}`}
        className="fixed right-0 top-0 z-[90] flex h-full w-full max-w-[440px] flex-col bg-white shadow-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#f0f0f0] px-[20px] py-[16px]">
          <div className="min-w-0">
            <div className="text-[9px] font-bold uppercase tracking-widest text-[#cfcfcf]">
              Компонент
            </div>
            <h3 className="font-mono text-[17px] font-bold text-[#1f1f1f]">{component}</h3>
            {entry && (
              <p className="mt-[2px] text-[11px] text-[#9a9a9a]">
                {entry.count} використань · {entry.routes.length} екранів
              </p>
            )}
            {api?.summary && (
              <p className="mt-[6px] text-[12px] leading-relaxed text-[#71717a]">{api.summary}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрити"
            className="grid h-[28px] w-[28px] shrink-0 cursor-pointer place-items-center rounded-[8px] text-[#9a9a9a] transition-colors hover:bg-[#f4f4f5] hover:text-[#1f1f1f]"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-[20px] py-[16px]">
          {/* The API first: "how do I call this" is the question somebody has
              while looking at a preview, and it used to have no answer on this
              page at all. Extracted from the component, so it cannot describe a
              signature the component no longer has. */}
          {api?.props.length > 0 && (
            <section className="mb-[20px]">
              <h4 className="mb-[8px] text-[10px] font-bold uppercase tracking-wider text-[#9a9a9a]">
                Пропси ({api.props.length})
              </h4>
              <div className="flex flex-col gap-[5px]">
                {api.props.map(prop => <PropRow key={prop.name} prop={prop} />)}
              </div>
              <p className="mt-[8px] font-mono text-[10px] text-[#cfcfcf]">{api.file}</p>
            </section>
          )}

          {!entry && (
            <p className="text-[12px] text-[#9a9a9a]">
              Продукт не імпортує цей компонент — він є лише в каталозі.
            </p>
          )}

          {entry && (
            <>
              <section>
                <h4 className="mb-[8px] text-[10px] font-bold uppercase tracking-wider text-[#9a9a9a]">
                  Екрани
                </h4>
                <div className="flex flex-wrap gap-[4px]">
                  {entry.routes.map(route => <RouteLink key={route} route={route} />)}
                </div>
              </section>

              {Object.keys(variants).length > 0 && (
                <section className="mt-[20px]">
                  <h4 className="mb-[8px] text-[10px] font-bold uppercase tracking-wider text-[#9a9a9a]">
                    Варіанти в продукті
                  </h4>
                  <div className="flex flex-col gap-[12px]">
                    {Object.entries(variants).map(([prop, values]) => {
                      const rows = Object.entries(values).sort((a, b) => b[1].count - a[1].count);
                      if (rows.length === 0) return null;
                      return (
                        <div key={prop}>
                          <div className="mb-[4px] font-mono text-[11px] font-bold text-[#1f1f1f]">{prop}</div>
                          <div className="flex flex-col gap-[3px]">
                            {rows.map(([value, info]) => (
                              <div
                                key={value}
                                className={`flex items-center gap-[8px] rounded-[7px] px-[8px] py-[5px] ${
                                  info.count <= 2 ? 'bg-[#fffbeb]' : 'bg-[#fafafa]'
                                }`}
                              >
                                <span className="font-mono text-[11px] text-[#1f1f1f]">{value}</span>
                                <span
                                  title={info.count <= 2 ? 'Рідкісний варіант — кандидат на злиття' : ''}
                                  className={`ml-auto shrink-0 rounded-full px-[7px] py-[1px] text-[10px] font-bold ${
                                    info.count <= 2 ? 'bg-[#fef3c7] text-[#b45309]' : 'bg-[#ecfdf5] text-[#047857]'
                                  }`}
                                >
                                  ×{info.count}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-[8px] text-[10px] leading-relaxed text-[#cfcfcf]">
                    Жовтим позначені варіанти з двома або менше використаннями — кандидати на
                    злиття з найближчим канонічним.
                  </p>
                </section>
              )}

              <section className="mt-[20px]">
                <h4 className="mb-[8px] text-[10px] font-bold uppercase tracking-wider text-[#9a9a9a]">
                  Файли ({entry.usedIn.length})
                </h4>
                <ul className="flex flex-col gap-[3px]">
                  {entry.usedIn.map(file => (
                    <li key={file} className="truncate font-mono text-[10px] text-[#71717a]" title={file}>
                      {file}
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
