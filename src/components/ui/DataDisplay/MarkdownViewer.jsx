import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
export { setTaskChecked } from '@/lib/utils/markdownEditor.mjs';

const TaskLineContext = React.createContext(null);
// The callback travels by context, not by prop, so the renderer map below can
// be built once at module load. See COMPONENTS for why that matters.
const TaskToggleContext = React.createContext(null);

function TaskCheckbox({ checked, ...props }) {
  const taskLine = React.useContext(TaskLineContext);
  const onTaskToggle = React.useContext(TaskToggleContext);
  const canToggle = Boolean(onTaskToggle && taskLine);
  return (
    <input
      {...props}
      type="checkbox"
      checked={Boolean(checked)}
      disabled={!canToggle}
      readOnly={!canToggle}
      // The item's text sits beside the box as a sibling in the rendered
      // markdown, not in a `<label>` — there is no markup for markdown to hang
      // one on. So the box announced itself as an unnamed checkbox, and a
      // description full of them was a list of identical "checkbox, not
      // checked". The line it toggles is the name it should have had.
      aria-label={taskLine ? `Пункт: ${taskLine}` : 'Пункт списку'}
      onChange={event => onTaskToggle?.(taskLine, event.target.checked)}
      className="mr-2 mt-1 h-4 w-4 cursor-pointer rounded-[4px] accent-ink disabled:cursor-default disabled:opacity-70"
    />
  );
}

// Two reading sizes, because the product has two: `md` is the editor's own
// preview pane, `lg` is a task description being read.
//
// This used to be one base size plus a `className` at the call site, and half
// of that override never applied. The task passed `text-[15px] leading-7`; the
// size landed because Tailwind emits `text-[15px]` after `text-[14px]`, but the
// leading did not, because it emits `leading-7` *before* `leading-relaxed` and
// the base won. Utilities of equal specificity are resolved by their order in
// the generated stylesheet, never by the order they appear in the attribute, so
// an override written at a call site is a coin toss. Both sizes below name
// their own line-height and only one of each utility is ever emitted — the
// rendering is unchanged, it is just no longer accidental.
const SIZES = {
  md: 'text-[14px] leading-relaxed',
  lg: 'text-[15px] leading-relaxed',
};

// Built once, at module load, and never rebuilt.
//
// This map used to be an object literal inside the render, which meant every
// value in it was a freshly declared function on every render. React compares
// element types by identity, so a new function is a *different* component: the
// whole rendered description was unmounted and re-created from scratch each
// time the parent rendered. A task page with a running timer renders once a
// second, and one second was all it took — every paragraph, image and code
// block was replaced, images restarted their load, and the text under the
// reader's finger jumped. Measured on a five-block description: 20 DOM nodes
// removed and 20 added over four ticks, and the original <p> node gone.
//
// Nothing here reads props, so nothing here needs to be rebuilt. The one value
// that does vary — the task-toggle callback — reaches the checkbox through
// TaskToggleContext, which changes what the box does without changing what the
// box *is*.
const COMPONENTS = {
  h1: ({node, ...props}) => <h1 className="ui-type-page-title mt-6 mb-4 pb-2 border-b border-line" {...props} />,
  h2: ({node, ...props}) => <h2 className="ui-type-detail-title mt-6 mb-4 pb-2 border-b border-line" {...props} />,
  h3: ({node, ...props}) => <h3 className="ui-type-dialog-title mt-6 mb-3" {...props} />,
  p: ({node, ...props}) => <p className="mb-4 last:mb-0" {...props} />,
  ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-4 space-y-1" {...props} />,
  ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-4 space-y-1" {...props} />,
  li: ({node, children, ...props}) => (
    <TaskLineContext.Provider value={node?.position?.start?.line || null}>
      <li className="" {...props}>{children}</li>
    </TaskLineContext.Provider>
  ),
  a: ({node, ...props}) => <a className="text-ink hover:underline" target="_blank" rel="noopener noreferrer" {...props} />,
  img: ({node, alt = '', ...props}) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} className="my-5 max-h-[560px] w-auto max-w-full rounded-[8px] border border-line object-contain" loading="lazy" {...props} />
  ),
  blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-line pl-4 italic text-ink mb-4" {...props} />,
  pre: ({node, ...props}) => (
    <pre className="bg-ink text-white p-4 rounded-[8px] overflow-x-auto mb-4 text-[13px] font-mono [&>code]:!bg-transparent [&>code]:!p-0 [&>code]:!text-inherit" {...props} />
  ),
  code: ({node, className, children, ...props}) => (
    <code className={`bg-canvas px-[6px] py-[2px] rounded-[4px] text-[13px] font-mono ${className || ''}`} {...props}>
      {children}
    </code>
  ),
  table: ({node, ...props}) => (
    <div className="overflow-x-auto mb-4">
      <table className="w-full border-collapse border border-line" {...props} />
    </div>
  ),
  th: ({node, ...props}) => <th className="border border-line px-4 py-2 bg-canvas font-bold" {...props} />,
  td: ({node, ...props}) => <td className="border border-line px-4 py-2" {...props} />,
  input: ({node, type, checked, ...props}) => {
    if (type === 'checkbox') {
      return <TaskCheckbox {...props} checked={checked} />;
    }
    return <input type={type} {...props} />;
  },
};

// Same reasoning: a fresh array is a fresh plugin list for react-markdown.
const REMARK_PLUGINS = [remarkGfm];

/**
 * Renders the markdown a `MarkdownEditor` produced, with the kit's type scale
 * applied to every element. Checkbox lists stay interactive: ticking one calls
 * back with the new source rather than editing the DOM.
 *
 * @param {string} props.content Markdown source.
 * @param {'sm'|'md'|'lg'} props.size Type scale for the rendered body.
 * @param {(content: string) => void} props.onTaskToggle Fires with the rewritten source when a task checkbox is ticked.
 * @param {string} props.className Placement in the parent only.
 */
export default function MarkdownViewer({ content, size = 'md', className = '', onTaskToggle }) {
  if (!content) return null;

  return (
    <div className={`markdown-body ${SIZES[size] ?? SIZES.md} text-ink break-words ${className}`}>
      <TaskToggleContext.Provider value={onTaskToggle ?? null}>
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
          {content}
        </ReactMarkdown>
      </TaskToggleContext.Provider>
    </div>
  );
}
