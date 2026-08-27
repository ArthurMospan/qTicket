import React, { useCallback, useEffect, useRef, useState } from 'react';
import MarkdownViewer from '@/components/ui/DataDisplay/MarkdownViewer';
import IconAction from '@/components/ui/IconAction';
import {
  continueMarkdownList,
  formatHeading,
  formatInline,
  formatList,
  indentLines,
  insertBlock as insertMarkdownBlock,
  insertCodeBlock as createCodeBlock,
  insertLink as createLink,
  setTaskChecked,
} from '@/lib/utils/markdownEditor.mjs';
import {
  Bold,
  Braces,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Code2,
  Columns2,
  Eye,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Minus,
  Paperclip,
  Pencil,
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  Undo2,
} from 'lucide-react';
import { ATTACHMENT_UPLOAD_ACCEPT } from '@/lib/utils/uploadPolicy.mjs';

const MAX_HISTORY = 120;

function ToolbarButton({ icon: Icon, label, onClick, disabled = false, active = false }) {
  return (
    <IconAction
      label={label}
      icon={Icon}
      // Sixteen icons in a row and no text anywhere: this is the toolbar the
      // missing tooltips were reported on.
      tooltip="bottom"
      size="md"
      // `editor`/`editor-active` were merged away as byte-identical duplicates
      // and this call site was never updated, so every toolbar button — pressed
      // or not — silently fell back to the default appearance and the active
      // state was invisible. `soft`/`quiet` are the kit's existing toggle pair.
      appearance={active ? 'soft' : 'quiet'}
      aria-pressed={active || undefined}
      disabled={disabled}
      onMouseDown={event => event.preventDefault()}
      onClick={onClick}
    />
  );
}

function ToolbarDivider() {
  return <span className="mx-1 h-4 w-px shrink-0 bg-line" aria-hidden="true" />;
}

function cleanFileName(name = 'file') {
  return name.replace(/[\[\]]/g, '').trim() || 'file';
}

/**
 * The description editor: a markdown textarea with a formatting toolbar, its
 * own undo history, a preview tab and file upload.
 *
 * @param {string} props.value Markdown source.
 * @param {(value: string) => void} props.onChange Fires with the new source.
 * @param {string} props.placeholder Text shown while empty.
 * @param {string} props.minHeight CSS height the writing area starts at.
 * @param {'write'|'preview'} props.defaultTab Which tab opens first.
 * @param {'card'|'flush'} props.frame `card` is a bordered, rounded box of its own. `flush` drops the border and inherits the radius, for when the editor fills a panel and *is* that panel rather than a second box inside it — the parent must clip (`overflow: hidden`).
 * @param {(files: File[]) => Promise<string[]>} props.onUploadFiles Uploads dropped or picked files and returns their URLs.
 * @param {boolean} props.uploading Busy: the toolbar's upload action is blocked while a file is in flight.
 */
export default function MarkdownEditor({
  value = '',
  onChange,
  placeholder = 'Напишіть опис завдання...',
  minHeight = '150px',
  defaultTab = 'write',
  frame = 'card',
  onUploadFiles,
  uploading = false,
}) {
  const initialMode = defaultTab === 'preview' ? 'preview' : 'write';
  const [mode, setMode] = useState(initialMode);
  const [fullscreen, setFullscreen] = useState(false);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const valueRef = useRef(value);
  const historyRef = useRef([{ value, selectionStart: 0, selectionEnd: 0 }]);
  const historyIndexRef = useRef(0);
  const lastHistoryAtRef = useRef(0);

  useEffect(() => {
    if (value === valueRef.current) return;
    valueRef.current = value;
    historyRef.current = [{ value, selectionStart: 0, selectionEnd: 0 }];
    historyIndexRef.current = 0;
    selectionRef.current = { start: 0, end: 0 };
    setHistoryState({ canUndo: false, canRedo: false });
  }, [value]);

  const focusSelection = useCallback((start, end = start) => {
    selectionRef.current = { start, end };
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start, end);
    });
  }, []);

  const commit = useCallback((nextValue, selectionStart, selectionEnd = selectionStart, { coalesce = false, record = true } = {}) => {
    valueRef.current = nextValue;
    onChange(nextValue);

    if (record) {
      const now = Date.now();
      const history = historyRef.current.slice(0, historyIndexRef.current + 1);
      const canCoalesce = coalesce && now - lastHistoryAtRef.current < 700 && history.length > 1;
      const entry = { value: nextValue, selectionStart, selectionEnd };
      if (canCoalesce) history[history.length - 1] = entry;
      else history.push(entry);
      if (history.length > MAX_HISTORY) history.shift();
      historyRef.current = history;
      historyIndexRef.current = history.length - 1;
      lastHistoryAtRef.current = now;
      setHistoryState({ canUndo: historyIndexRef.current > 0, canRedo: false });
    }

    focusSelection(selectionStart, selectionEnd);
  }, [focusSelection, onChange]);

  const currentSelection = useCallback(() => {
    const text = valueRef.current;
    const remembered = selectionRef.current;
    return {
      text,
      start: Math.min(remembered.start, text.length),
      end: Math.min(remembered.end, text.length),
    };
  }, []);

  const rememberSelection = useCallback((event) => {
    selectionRef.current = {
      start: event.currentTarget.selectionStart,
      end: event.currentTarget.selectionEnd,
    };
  }, []);

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const entry = historyRef.current[historyIndexRef.current];
    valueRef.current = entry.value;
    onChange(entry.value);
    setHistoryState({
      canUndo: historyIndexRef.current > 0,
      canRedo: historyIndexRef.current < historyRef.current.length - 1,
    });
    focusSelection(entry.selectionStart, entry.selectionEnd);
  }, [focusSelection, onChange]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const entry = historyRef.current[historyIndexRef.current];
    valueRef.current = entry.value;
    onChange(entry.value);
    setHistoryState({
      canUndo: historyIndexRef.current > 0,
      canRedo: historyIndexRef.current < historyRef.current.length - 1,
    });
    focusSelection(entry.selectionStart, entry.selectionEnd);
  }, [focusSelection, onChange]);

  const applyInline = useCallback((before, after = before, fallback = 'текст') => {
    const { text, start, end } = currentSelection();
    const result = formatInline(text, start, end, before, after, fallback);
    commit(result.value, result.selectionStart, result.selectionEnd);
  }, [commit, currentSelection]);

  const applyHeading = useCallback((level) => {
    const { text, start, end } = currentSelection();
    const result = formatHeading(text, start, end, level);
    commit(result.value, result.selectionStart, result.selectionEnd);
  }, [commit, currentSelection]);

  const applyList = useCallback((kind) => {
    const { text, start, end } = currentSelection();
    const result = formatList(text, start, end, kind);
    commit(result.value, result.selectionStart, result.selectionEnd);
  }, [commit, currentSelection]);

  const insertLink = useCallback(() => {
    const { text, start, end } = currentSelection();
    const result = createLink(text, start, end);
    commit(result.value, result.selectionStart, result.selectionEnd);
  }, [commit, currentSelection]);

  const insertBlock = useCallback((markdown, selectionOffset = markdown.length) => {
    const { text, start, end } = currentSelection();
    const result = insertMarkdownBlock(text, start, end, markdown, selectionOffset);
    commit(result.value, result.selectionStart, result.selectionEnd);
  }, [commit, currentSelection]);

  const insertCodeBlock = useCallback(() => {
    const { text, start, end } = currentSelection();
    const result = createCodeBlock(text, start, end);
    commit(result.value, result.selectionStart, result.selectionEnd);
  }, [commit, currentSelection]);

  const uploadAndInsert = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    if (!onUploadFiles || files.length === 0) return;
    const { text, start, end } = currentSelection();
    const uploaded = await onUploadFiles(files);
    if (!uploaded?.length) return;

    const markdown = uploaded.map(file => {
      const url = file.url || file.downloadUrl || file.downloadURL;
      const name = cleanFileName(file.name);
      return file.type?.startsWith('image/') ? `![${name}](${url})` : `[${name}](${url})`;
    }).join('\n\n');
    const prefix = start > 0 && !text.slice(0, start).endsWith('\n') ? '\n\n' : '';
    const suffix = end < text.length && !text.slice(end).startsWith('\n') ? '\n\n' : '';
    const next = text.slice(0, start) + prefix + markdown + suffix + text.slice(end);
    const cursor = start + prefix.length + markdown.length;
    commit(next, cursor, cursor);
  }, [commit, currentSelection, onUploadFiles]);

  const indentSelection = useCallback((outdent = false) => {
    const { text, start, end } = currentSelection();
    const result = indentLines(text, start, end, outdent);
    commit(result.value, result.selectionStart, result.selectionEnd);
  }, [commit, currentSelection]);

  const continueList = useCallback((event) => {
    const { text, start, end } = currentSelection();
    const result = continueMarkdownList(text, start, end);
    if (!result) return false;
    event.preventDefault();
    commit(result.value, result.selectionStart, result.selectionEnd);
    return true;
  }, [commit, currentSelection]);

  const handleKeyDown = useCallback((event) => {
    const command = event.metaKey || event.ctrlKey;
    if (command && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      applyInline('**', '**', 'жирний текст');
      return;
    }
    if (command && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      applyInline('*', '*', 'курсив');
      return;
    }
    if (command && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      insertLink();
      return;
    }
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (command && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      indentSelection(event.shiftKey);
      return;
    }
    if (event.key === 'Enter') continueList(event);
  }, [applyInline, continueList, indentSelection, insertLink, redo, undo]);

  const handleTextChange = useCallback((event) => {
    const nextValue = event.target.value;
    selectionRef.current = { start: event.target.selectionStart, end: event.target.selectionEnd };
    commit(nextValue, event.target.selectionStart, event.target.selectionEnd, { coalesce: true });
  }, [commit]);

  const toggleTask = useCallback((taskLine, checked) => {
    const next = setTaskChecked(valueRef.current, taskLine, checked);
    if (next === valueRef.current) return;
    const selection = selectionRef.current;
    commit(next, selection.start, selection.end);
  }, [commit]);

  const { canUndo, canRedo } = historyState;

  // Whether the toolbar has more to show in either direction.
  //
  // The row scrolls sideways when the editor is narrow, and «scrolls» is
  // something a trackpad owner discovers and a mouse owner does not: a plain
  // wheel scrolls the page, not the row, so half the toolbar simply was not
  // there. The two arrows below appear only when there is something behind
  // them and scroll on a click.
  //
  // They are drawn over the row rather than beside it, so appearing does not
  // take width from what they are reporting on — an arrow that made the row
  // narrower could make itself necessary, and then unnecessary, and flicker
  // between the two.
  const toolbarRef = useRef(null);
  const [toolbarOverflow, setToolbarOverflow] = useState({ start: false, end: false });

  useEffect(() => {
    const node = toolbarRef.current;
    if (!node) return undefined;
    const measure = () => {
      const remaining = node.scrollWidth - node.clientWidth - node.scrollLeft;
      setToolbarOverflow(current => {
        // A pixel of slack: sub-pixel layout leaves a fraction behind at the
        // end of a row that has genuinely finished scrolling.
        const next = { start: node.scrollLeft > 1, end: remaining > 1 };
        return next.start === current.start && next.end === current.end ? current : next;
      });
    };
    measure();
    node.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      node.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [onUploadFiles, fullscreen, mode]);

  const scrollToolbar = useCallback(direction => {
    const node = toolbarRef.current;
    if (!node) return;
    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // Most of a screenful, so a click makes visible progress without landing
    // somewhere nobody asked for.
    node.scrollBy({
      left: direction * Math.max(120, node.clientWidth * 0.7),
      behavior: reduced ? 'auto' : 'smooth',
    });
  }, []);
  // Fullscreen is always its own box, whatever frame the inline editor wears.
  const editorClassName = fullscreen
    ? 'fixed inset-3 z-[200] flex flex-col overflow-hidden rounded-[16px] border border-line bg-white sm:inset-6'
    : frame === 'flush'
      ? 'flex w-full flex-col overflow-hidden rounded-[inherit] bg-white'
      : 'flex w-full flex-col overflow-hidden rounded-[16px] border border-line bg-white';

  return (
    <div className={editorClassName}>
      <div className="flex min-w-0 items-center gap-1 border-b border-line bg-canvas p-1.5">
        <div className="flex items-center gap-0.5">
          <ToolbarButton icon={Undo2} label="Скасувати (Ctrl+Z)" onClick={undo} disabled={!canUndo} />
          <ToolbarButton icon={Redo2} label="Повторити (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo} />
        </div>
        <ToolbarDivider />
        <div className="relative flex min-w-0 flex-1 items-center">
          {toolbarOverflow.start && (
            <div className="pointer-events-none absolute left-0 z-10 flex items-center bg-gradient-to-r from-canvas via-canvas to-transparent pr-3">
              <span className="pointer-events-auto">
                <ToolbarButton icon={ChevronLeft} label="Прокрутити ліворуч" onClick={() => scrollToolbar(-1)} />
              </span>
            </div>
          )}
          {toolbarOverflow.end && (
            <div className="pointer-events-none absolute right-0 z-10 flex items-center bg-gradient-to-l from-canvas via-canvas to-transparent pl-3">
              <span className="pointer-events-auto">
                <ToolbarButton icon={ChevronRight} label="Прокрутити праворуч" onClick={() => scrollToolbar(1)} />
              </span>
            </div>
          )}
          <div ref={toolbarRef} className="hide-scrollbar flex min-w-0 flex-1 items-center overflow-x-auto">
            <ToolbarButton icon={Heading1} label="Заголовок 1" onClick={() => applyHeading(1)} />
            <ToolbarButton icon={Heading2} label="Заголовок 2" onClick={() => applyHeading(2)} />
            <ToolbarButton icon={Heading3} label="Заголовок 3" onClick={() => applyHeading(3)} />
            <ToolbarDivider />
            <ToolbarButton icon={Bold} label="Жирний (Ctrl+B)" onClick={() => applyInline('**', '**', 'жирний текст')} />
            <ToolbarButton icon={Italic} label="Курсив (Ctrl+I)" onClick={() => applyInline('*', '*', 'курсив')} />
            <ToolbarButton icon={Strikethrough} label="Закреслений" onClick={() => applyInline('~~', '~~', 'закреслений текст')} />
            <ToolbarButton icon={Code2} label="Вбудований код" onClick={() => applyInline('`', '`', 'код')} />
            <ToolbarDivider />
            <ToolbarButton icon={List} label="Маркований список" onClick={() => applyList('bullet')} />
            <ToolbarButton icon={ListOrdered} label="Нумерований список" onClick={() => applyList('ordered')} />
            <ToolbarButton icon={CheckSquare} label="Чекліст" onClick={() => applyList('task')} />
            <ToolbarButton icon={Quote} label="Цитата" onClick={() => applyList('quote')} />
            <ToolbarDivider />
            {/* Ahead of the link rather than at the end of the row. The toolbar
                scrolls when the editor is narrow — which is what the composer's
                editor is — and last in a scrolling row means invisible until
                somebody thinks to drag it. It belongs with the other three
                «insert something» buttons anyway. */}
            {onUploadFiles && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ATTACHMENT_UPLOAD_ACCEPT}
                  multiple
                  className="hidden"
                  onChange={event => {
                    uploadAndInsert(event.target.files);
                    event.target.value = '';
                  }}
                />
                <ToolbarButton
                  icon={uploading ? LoaderCircle : Paperclip}
                  label="Додати зображення або файл"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                />
              </>
            )}
            <ToolbarButton icon={LinkIcon} label="Посилання (Ctrl+K)" onClick={insertLink} />
            <ToolbarButton icon={Braces} label="Блок коду" onClick={insertCodeBlock} />
            <ToolbarButton icon={Table2} label="Таблиця" onClick={() => insertBlock('| Колонка 1 | Колонка 2 |\n| --- | --- |\n| Значення | Значення |')} />
            <ToolbarButton icon={Minus} label="Розділювач" onClick={() => insertBlock('---')} />
          </div>
        </div>
        <ToolbarDivider />
        <div className="flex items-center gap-0.5 rounded-[10px] bg-black/[0.04] p-0.5">
          <ToolbarButton icon={Pencil} label="Редагування" active={mode === 'write'} onClick={() => setMode('write')} />
          <ToolbarButton icon={Columns2} label="Редагування і перегляд" active={mode === 'split'} onClick={() => setMode('split')} />
          <ToolbarButton icon={Eye} label="Попередній перегляд" active={mode === 'preview'} onClick={() => setMode('preview')} />
        </div>
        <ToolbarButton icon={fullscreen ? Minimize2 : Maximize2} label={fullscreen ? 'Вийти з повноекранного режиму' : 'Повноекранний режим'} onClick={() => setFullscreen(current => !current)} />
      </div>

      <div className={`min-h-0 flex-1 ${mode === 'split' ? 'grid md:grid-cols-2' : 'block'}`}>
        {mode !== 'preview' && (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleTextChange}
            onSelect={rememberSelection}
            onClick={rememberSelection}
            onKeyUp={rememberSelection}
            onKeyDown={handleKeyDown}
            onPaste={event => {
              if (!onUploadFiles || event.clipboardData.files.length === 0) return;
              event.preventDefault();
              uploadAndInsert(event.clipboardData.files);
            }}
            onDrop={event => {
              if (!onUploadFiles || event.dataTransfer.files.length === 0) return;
              event.preventDefault();
              uploadAndInsert(event.dataTransfer.files);
            }}
            onDragOver={event => {
              if (onUploadFiles && event.dataTransfer.types.includes('Files')) event.preventDefault();
            }}
            placeholder={placeholder}
            className={`custom-scrollbar w-full resize-none bg-white p-4 text-[14px] leading-6 text-ink outline-none placeholder:text-faint ${mode === 'split' ? 'border-b border-line md:border-b-0 md:border-r' : ''}`}
            style={{ minHeight: fullscreen ? 'calc(100dvh - 112px)' : minHeight }}
            spellCheck
          />
        )}
        {mode !== 'write' && (
          <div
            className="custom-scrollbar w-full overflow-y-auto bg-white p-4"
            style={{ minHeight: fullscreen ? 'calc(100dvh - 112px)' : minHeight }}
          >
            {value.trim() ? (
              <MarkdownViewer content={value} onTaskToggle={toggleTask} />
            ) : (
              <p className="text-[14px] italic text-muted">Опис ще порожній</p>
            )}
          </div>
        )}
      </div>

      <div className="flex h-7 items-center justify-end gap-3 border-t border-line bg-canvas px-3 text-[10px] font-medium text-muted">
        <span>{value.trim() ? value.trim().split(/\s+/).length : 0} слів</span>
        <span>{value.length} символів</span>
      </div>
    </div>
  );
}
