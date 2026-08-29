'use client';
import { useState } from 'react';
import Button from '@/components/ui/Button';
import { ChatComposerCore } from '@/components/ui';
import ChatComposerDock from '@/components/ui/ChatComposerDock';
import { Paperclip } from 'lucide-react';
import { PreviewBlock } from '../preview';

export default function ChatComposerSection() {
  const [message, setMessage] = useState('');

  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock
        title="Композер розмови"
        description="Поле, у якому пишуть відповідь у зверненні — і єдине поле розмови, що лишилось у продукті. Тут стояли два: це й корпоративного месенджера, з власним кільцем, власним ростом поля та підписаною кнопкою «Надіслати». Месенджера видалено, і другої геометрії разом із ним немає. ChatComposerDock відповідає лише за overlap: він міряє себе й віддає стрічці рівно ту нижню подушку, за якою останнє повідомлення не ховається під полем."
        filePath="src/components/workspace/UnifiedTimeline.jsx"
        component="ChatComposerCore"
        fullWidth
      >
        <div className="grid w-full grid-cols-1 gap-[16px]">
          <div className="flex h-[210px] flex-col overflow-hidden rounded-[16px] bg-canvas">
            <div className="flex-1 p-4 text-[12px] text-muted">Стрічка звернення</div>
            <ChatComposerDock composition="timeline-composer">
              <ChatComposerCore
                value={message}
                onChange={event => setMessage(event.target.value)}
                placeholder="Написати відповідь клієнту..."
                leading={<Button className="self-center rounded-full" style="ghost" size="icon-sm" icon={Paperclip} type="button" aria-label="Додати файл" />}
                onSubmit={() => setMessage('')}
                canSubmit={Boolean(message.trim())}
              />
            </ChatComposerDock>
          </div>
        </div>
      </PreviewBlock>
    </div>
  );
}
