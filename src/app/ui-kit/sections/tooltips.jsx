'use client';
import Button from '@/components/ui/Button';
import { Tooltip } from '@/components/ui';
import { PreviewBlock } from '../preview';

export default function TooltipsSection() {
  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock title="Tooltip Component" component="Tooltip" description="Компонент підказки, який з'являється при наведенні. Підтримує 4 позиції: top (default), bottom, left, right." fullWidth>
        <div className="flex items-center gap-[24px] justify-center w-full py-[40px]">
          <Tooltip content="Підказка зверху" position="top">
            <Button style="secondary">Наведи (Top)</Button>
          </Tooltip>
          <Tooltip content="Підказка знизу" position="bottom">
            <Button style="secondary">Наведи (Bottom)</Button>
          </Tooltip>
          <Tooltip content="Підказка зліва" position="left">
            <Button style="secondary">Наведи (Left)</Button>
          </Tooltip>
          <Tooltip content="Підказка справа" position="right">
            <Button style="secondary">Наведи (Right)</Button>
          </Tooltip>
        </div>
      </PreviewBlock>
    </div>
  );
}
