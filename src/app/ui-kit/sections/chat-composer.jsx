'use client';
import { useState } from 'react';
import Button from '@/components/ui/Button';
import { EmptyState, ChatComposerCore } from '@/components/ui';
import ChatComposerDock from '@/components/ui/ChatComposerDock';
import { Info, Hash, Paperclip, Smile } from 'lucide-react';
import { ChatIcon } from '@/lib/design/icons';
import { PreviewBlock } from '../preview';

export default function ChatComposerSection() {
  const [message, setMessage] = useState('');
  const canSend = Boolean(message.trim());

  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock
        title="Workspace Chat Composer"
        description="Точна композиція основного workspace-чату: той самий canvas, textarea, toolbar, attachment/emoji controls і send state. ChatComposerDock відповідає лише за overlap. Нижче md композер стає одним рядком — контроли, поле, кругла кнопка надсилання — і поле росте до 120px замість 200. Затверджено як канон; звузь вікно, щоб побачити перемикання."
        filePath="src/app/(app)/chat/page.js"
        fullWidth
      >
        <div className="h-[420px] w-full">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[16px] bg-canvas h-full">
          <div className="relative z-10 flex min-h-[64px] shrink-0 items-center gap-2 border-b border-line/70 bg-canvas/90 px-4 py-3 backdrop-blur-xl">
            <Hash size={17} className="shrink-0 text-ink" />
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-1.5 truncate text-[15px] font-bold text-ink">general</h2>
              <p className="truncate text-[11px] text-muted">Загальний канал для всієї команди</p>
            </div>
            <Info size={16} className="text-muted" />
          </div>

          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-12 pt-2 scroll-pb-12">
            <div className="flex h-full flex-1 items-center justify-center">
              <EmptyState
                icon={ChatIcon}
                title="Ще немає повідомлень"
                description="Почніть розмову! 👋"
              />
            </div>
          </div>

          <ChatComposerDock>
            <div className="relative px-4 pb-4">
              <ChatComposerCore
                variant="workspace"
                value={message}
                onChange={event => setMessage(event.target.value)}
                placeholder="Написати в #general..."
                toolbar={(
                  <>
                    <button
                      type="button"
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-ink transition-colors"
                      title="Emoji"
                    >
                      <Smile size={17} />
                    </button>
                    <button
                      type="button"
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-ink transition-colors"
                      title="Прикріпити файл"
                    >
                      <Paperclip size={17} />
                    </button>
                  </>
                )}
                onSubmit={() => setMessage('')}
                canSubmit={canSend}
              />
            </div>
          </ChatComposerDock>
        </div>
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Task Timeline & QuickTeam+ composers"
        description="Спільне ядро ChatComposerCore з двома продуктовими оболонками: timeline має attachment-control, QuickTeam+ — компактну shell без нього. Межу росту поля кожна оболонка оголошує своїм max-height у класі, а не константою в модулі — інакше її не змінила б жодна медіазапит."
        filePath="src/components/workspace/UnifiedTimeline.jsx"
        fullWidth
      >
        <div className="grid w-full grid-cols-1 gap-[16px] lg:grid-cols-2">
          <div className="flex h-[210px] flex-col overflow-hidden rounded-[16px] bg-canvas">
            <div className="flex-1 p-4 text-[12px] text-muted">Task timeline</div>
            <ChatComposerDock composition="timeline-composer">
              <ChatComposerCore
                variant="timeline"
                value=""
                onChange={() => {}}
                placeholder="Написати повідомлення..."
                leading={<Button className="self-center rounded-full" style="ghost" size="icon-sm" icon={Paperclip} type="button" aria-label="Додати файл" />}
                onSubmit={() => {}}
                canSubmit={false}
              />
            </ChatComposerDock>
          </div>

          <div className="flex h-[210px] flex-col overflow-hidden rounded-[16px] bg-canvas">
            <div className="flex-1 p-4 text-[12px] text-muted">QuickTeam+ chat</div>
            <ChatComposerDock composition="timeline-composer">
              <ChatComposerCore
                variant="qtplus"
                value=""
                onChange={() => {}}
                placeholder="Повідомлення…"
                onSubmit={() => {}}
                canSubmit={false}
              />
            </ChatComposerDock>
          </div>
        </div>
      </PreviewBlock>
    </div>
  );
}
