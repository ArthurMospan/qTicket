'use client';
import { useState } from 'react';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Forms/Textarea';
import { Label, Checkbox, ToggleSwitch, DatePicker, TimePicker, ImageUpload, StatusVisibilityPicker, ResponseChoice, ColorSwatch } from '@/components/ui';
import { DEFAULT_STATUSES } from '@/lib/hooks/useWorkflowConfig';
import { Search, User, Calendar, Lock, Eye, EyeOff } from 'lucide-react';
import { PreviewBlock } from '../preview';

export default function InputsSection() {
  const [val, setVal] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [chk, setChk] = useState(false);
  const [tgl, setTgl] = useState(true);
  const [dateSingle, setDateSingle] = useState('');
  const [timeSingle, setTimeSingle] = useState('09:00');
  const [hiddenStatusIds, setHiddenStatusIds] = useState(['done']);
  const [rsvp, setRsvp] = useState('accepted');
  const [swatch, setSwatch] = useState('#10b981');

  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock title="Named Input sizes — sm / md / lg" component="Input" description="Три живі висоти для Input та суміжних controls: sm 28px, md 32px, lg 36px. lg є стандартом за замовчуванням." fullWidth>
        <div className="max-w-[400px] flex flex-col gap-[12px]">
          <Input size="sm" placeholder="Small — 28px" />
          <Input size="md" placeholder="Medium — 32px" />
          <Input size="lg" placeholder="Large — 36px" value={val} onChange={e => setVal(e.target.value)} />
          <Input size="md" preset="money" suffix="₴/г" type="number" defaultValue="125" aria-label="Грошове значення" />
          <Input size="lg" placeholder="Заблоковане поле" disabled />
        </div>
      </PreviewBlock>

      <PreviewBlock title="Checkbox & Toggle" component="ToggleSwitch" description="Ті самі Checkbox і ToggleSwitch, які зараз використовує продукт.">
        <div className="flex items-center gap-[24px] flex-wrap">
          <Checkbox checked={chk} onChange={setChk} label="Я погоджуюся з умовами" id="chk-demo" />
          {/* Третій стан — для шапки списку, де вибрана частина рядків. Клік
              з нього дає «вибрано», бо «частково» це не те, чим можна стати. */}
          <Checkbox indeterminate onChange={() => {}} label="Вибрано частину" id="chk-indeterminate" />
          <ToggleSwitch checked={tgl} onChange={setTgl} label="Активний спринт" />
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Відповідь на запрошення"
        component="ResponseChoice"
        description="«Буду / Можливо / Не буду» у трьох розмірах. tile — свідомий вибір раз на подію, тому несе семантичні кольори; md і sm — швидка правка у списку, тому осідають на bg-ink: три кольорові чипи в рядку сповіщень читаються як три різні сповіщення. sm має два фони, бо трапляється і в білому списку сповіщень, і в сірому тості."
        filePath="src/components/ui/Forms/ResponseChoice.jsx"
        fullWidth
      >
        <div className="flex w-full flex-col gap-[16px]">
          <div className="w-full max-w-[320px]">
            <p className="mb-[6px] font-mono text-[10px] uppercase tracking-wider text-faint">size=&quot;tile&quot;</p>
            <ResponseChoice size="tile" value={rsvp} onChange={setRsvp} />
          </div>
          <div>
            <p className="mb-[6px] font-mono text-[10px] uppercase tracking-wider text-faint">size=&quot;md&quot;</p>
            <ResponseChoice size="md" value={rsvp} onChange={setRsvp} />
          </div>
          <div className="flex flex-wrap gap-[16px]">
            <div>
              <p className="mb-[6px] font-mono text-[10px] uppercase tracking-wider text-faint">size=&quot;sm&quot; surface=&quot;surface&quot;</p>
              <ResponseChoice size="sm" surface="surface" value={rsvp} onChange={setRsvp} />
            </div>
            <div className="rounded-[10px] bg-canvas p-2">
              <p className="mb-[6px] font-mono text-[10px] uppercase tracking-wider text-faint">size=&quot;sm&quot; surface=&quot;canvas&quot;</p>
              <ResponseChoice size="sm" surface="canvas" value={rsvp} onChange={setRsvp} />
            </div>
          </div>
          <div>
            <p className="mb-[6px] font-mono text-[10px] uppercase tracking-wider text-faint">disabled — поки відповідь зберігається</p>
            <ResponseChoice size="md" value={rsvp} onChange={setRsvp} disabled />
          </div>
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Зразок кольору"
        component="ColorSwatch"
        description="Дві ролі, і це справді різні контроли, а не два розміри одного. trigger показує, якого кольору щось зараз, і відкриває палітру — власного «обрано» він не має, обведення зʼявляється лише під курсором. choice — один варіант усередині цієї палітри, він трохи росте під курсором і несе чорне обведення, коли саме він вибраний. Вигляд не змінювався: це те саме, що налаштування малювали руками."
        filePath="src/components/ui/Forms/ColorSwatch.jsx"
      >
        <div className="flex items-center gap-[24px]">
          <div className="flex flex-col items-center gap-[8px]">
            <ColorSwatch size="trigger" color={swatch} label="Обрати колір" />
            <span className="text-[9px] text-[#cfcfcf]">trigger</span>
          </div>
          <div className="flex flex-col items-center gap-[8px]">
            <span className="flex gap-[6px]">
              {['#ef4444', '#f97316', '#10b981', '#3b82f6', '#8b5cf6'].map(colour => (
                <ColorSwatch
                  key={colour}
                  size="choice"
                  color={colour}
                  selected={colour === swatch}
                  label={`Колір ${colour}`}
                  onClick={() => setSwatch(colour)}
                />
              ))}
            </span>
            <span className="text-[9px] text-[#cfcfcf]">choice</span>
          </div>
          <div className="flex flex-col items-center gap-[8px]">
            <span className="flex gap-[12px]">
              <ColorSwatch size="theme" color="#1f1f1f" selected label="Темна тема" />
              <ColorSwatch size="theme" color="#ffffff" label="Світла тема" />
              <ColorSwatch size="theme" color="conic-gradient(#ef4444, #f59e0b, #22c55e, #3b82f6, #8b5cf6, #ec4899, #ef4444)" label="Своя тема" />
            </span>
            <span className="text-[9px] text-[#cfcfcf]">theme</span>
          </div>
        </div>
      </PreviewBlock>

      <PreviewBlock title="Project Status Visibility" description="Shared picker для створення й налаштувань проєкту. Беклог заблокований як обов’язкова fallback-колонка." fullWidth>
        <div className="max-w-[520px]">
          <StatusVisibilityPicker
            statuses={DEFAULT_STATUSES}
            hiddenStatusIds={hiddenStatusIds}
            onChange={setHiddenStatusIds}
          />
        </div>
      </PreviewBlock>

      <PreviewBlock title="Date & Time Pickers" description="Живі DatePicker і TimePicker, які використовуються у задачах, календарі та налаштуваннях." fullWidth>
        <div className="grid max-w-[532px] gap-3 sm:grid-cols-2">
          <div>
            <label className="text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider mb-[6px] block">Оберіть дату</label>
            <DatePicker value={dateSingle} onChange={setDateSingle} placeholder="Оберіть день..." />
          </div>
          <div>
            <label className="text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider mb-[6px] block">Оберіть час</label>
            <TimePicker value={timeSingle} onChange={setTimeSingle} aria-label="Демонстраційний час" />
          </div>
        </div>
      </PreviewBlock>

      <PreviewBlock title="Brand image upload" description="Фактичний світлий ImageUpload із налаштувань профілю та брендування." filePath="src/app/(app)/settings/page.js" fullWidth>
        <div className="max-w-[380px] rounded-[16px] border border-line bg-white p-[20px]">
          <ImageUpload value="/favicon.png" onChange={() => {}} theme="light" />
        </div>
      </PreviewBlock>

      <PreviewBlock title="With Icon" description="icon prop — Search, Calendar, User, etc." fullWidth>
        <div className="flex flex-col gap-[10px] max-w-[400px]">
          <Input placeholder="Пошук..." icon={Search} />
          <Input placeholder="Email адреса" icon={User} />
          <Input placeholder="Дата" icon={Calendar} />
        </div>
      </PreviewBlock>

      <PreviewBlock title="Password / Toggle" description="Pattern for password fields with show/hide toggle." fullWidth>
        <div className="max-w-[400px]">
          <div className="relative">
            <Input type={show ? 'text' : 'password'} placeholder="Пароль" value={pw} onChange={e => setPw(e.target.value)} icon={Lock} />
            <button
              onClick={() => setShow(s => !s)}
              className="absolute right-[10px] top-1/2 -translate-y-1/2 text-[#9a9a9a] hover:text-[#1f1f1f] transition-colors"
            >
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
      </PreviewBlock>

      <PreviewBlock title="Validation State" description="error prop shows red border + error message below." fullWidth>
        <div className="max-w-[400px] flex flex-col gap-[10px]">
          <Input placeholder="Email" error="Невірна адреса електронної пошти" defaultValue="bad@" />
          <Input placeholder="Назва проєкту" error="Поле обов'язкове" />
        </div>
      </PreviewBlock>

      <PreviewBlock title="Inline: Input + Button" description="36px input + 36px button — zero-pixel alignment." fullWidth>
        <div className="flex items-center gap-[8px] max-w-[500px]">
          <Input placeholder="Введіть email для запрошення..." icon={User} />
          <Button style="primary" size="lg">Запросити</Button>
        </div>
      </PreviewBlock>

      <PreviewBlock title="Textarea" component="Textarea" description="Багаторядкові текстові області. Кольори: фон #f4f4f5, фокус-рамка #1f1f1f. Скруглення: 10px. Зміна розміру (resize) вимкнена за замовчуванням." fullWidth>
        <div className="max-w-[500px] flex flex-col gap-[10px]">
          <Textarea placeholder="Опис завдання або проєкту..." rows={3} />
          <Textarea placeholder="Великий опис..." rows={6} />
        </div>
      </PreviewBlock>

      <PreviewBlock title="Form label pattern" component="Label" description="Always 11px, bold, uppercase, tracking-wider, color #9a9a9a." fullWidth>
        <div className="max-w-[400px] flex flex-col gap-[16px]">
          <div>
            <Label htmlFor="kit-project-name" required className="mb-[6px] block">Назва проєкту</Label>
            <Input id="kit-project-name" placeholder="Наприклад: Редизайн сайту" />
          </div>
          <div>
            <Label htmlFor="kit-project-description" className="mb-[6px] block">Опис</Label>
            <Textarea id="kit-project-description" placeholder="Короткий опис..." rows={3} />
          </div>
        </div>
      </PreviewBlock>
    </div>
  );
}
