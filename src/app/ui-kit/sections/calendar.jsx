'use client';
import { CalendarEntry, CalendarDayNumber, CalendarDayCell, CalendarHourSlot, IconAction } from '@/components/ui';
import { CalendarClock, LockKeyhole, Plus, Users } from 'lucide-react';
import { PreviewBlock } from '../preview';

const EVENT_TINTS = {
  meeting: { color: '#6366f1', bg: '#eef2ff', icon: Users },
  reminder: { color: '#0891b2', bg: '#ecfeff', icon: CalendarClock },
};

// Два тижні серпня так, як їх бачить телефон: крапки — типи подій, червона —
// дедлайн задачі.
const DEADLINE_DOT = '#ef4444';
const PHONE_MONTH = [
  { date: 28, state: 'outside' }, { date: 29, state: 'outside' }, { date: 30, state: 'outside' },
  { date: 31, state: 'outside' },
  { date: 1, state: 'default', dots: [EVENT_TINTS.meeting.color] },
  { date: 2, state: 'weekend' }, { date: 3, state: 'weekend' },
  { date: 4, state: 'default' },
  { date: 5, state: 'default', dots: [EVENT_TINTS.meeting.color, DEADLINE_DOT] },
  { date: 6, state: 'default' },
  { date: 7, state: 'selected', dots: [EVENT_TINTS.meeting.color, EVENT_TINTS.reminder.color, DEADLINE_DOT] },
  { date: 8, state: 'today', dots: [EVENT_TINTS.reminder.color] },
  { date: 9, state: 'weekend' },
  { date: 10, state: 'weekend', dots: [EVENT_TINTS.reminder.color] },
];

export default function CalendarSection() {
  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock
        title="Запис у комірці дня"
        component="CalendarEntry"
        description="Дві форми одного запису. event — плитка, підфарбована під тип події, з кольоровою рискою ліворуч; обидва кольори приходять із бази під час рендера, тому це inline style, а не клас. deadline — біла з рамкою, бо власного кольору типу не має. compact — геометрія місяця, звичайна — тижня, де під назвою вміщується ще й час."
        filePath="src/components/ui/Calendar/CalendarEntry.jsx"
        fullWidth
      >
        <div className="flex w-full flex-wrap gap-[24px]">
          <div className="w-[200px]">
            <p className="mb-[6px] font-mono text-[10px] uppercase tracking-wider text-faint">compact — місяць</p>
            <div className="flex flex-col gap-[4px] rounded-[10px] border border-line bg-white p-[7px]">
              <CalendarEntry
                tone="event"
                compact
                accent={EVENT_TINTS.meeting.color}
                background={EVENT_TINTS.meeting.bg}
                title="10:00 Планерка"
                leading={<Users size={11} style={{ color: EVENT_TINTS.meeting.color }} className="shrink-0" />}
              />
              <CalendarEntry
                tone="event"
                compact
                accent={EVENT_TINTS.reminder.color}
                background={EVENT_TINTS.reminder.bg}
                title="Приватна подія"
                leading={<CalendarClock size={11} style={{ color: EVENT_TINTS.reminder.color }} className="shrink-0" />}
                trailing={<LockKeyhole size={10} className="ml-auto shrink-0 text-muted" aria-label="Приватна подія" />}
              />
              <CalendarEntry
                tone="deadline"
                compact
                leading={<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />}
                title="QT-104 · Здати макет"
              />
              <CalendarEntry
                tone="deadline"
                compact
                dimmed
                leading={<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />}
                title="QT-98 · Уже здано"
              />
            </div>
          </div>

          <div className="w-[220px]">
            <p className="mb-[6px] font-mono text-[10px] uppercase tracking-wider text-faint">звичайна — тиждень</p>
            <div className="flex flex-col gap-[4px] rounded-[10px] border border-line bg-white p-[7px]">
              <CalendarEntry
                tone="event"
                accent={EVENT_TINTS.meeting.color}
                background={EVENT_TINTS.meeting.bg}
                title="Планерка команди"
                leading={<Users size={12} style={{ color: EVENT_TINTS.meeting.color }} className="shrink-0" />}
                meta="10:00–10:30"
              />
              <CalendarEntry
                tone="deadline"
                leading={<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />}
                title="QT-104 · Здати макет"
              />
            </div>
          </div>
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Число дня"
        component="CalendarDayNumber"
        description="Дата в кутку комірки — і водночас контрол, що відкриває цей день. Три стани: сьогодні, звичайний день поточного місяця, і день сусіднього місяця, який видно на краях сітки."
        filePath="src/components/ui/Calendar/CalendarDayNumber.jsx"
      >
        <div className="flex items-end gap-[20px]">
          {[['today', '14', 'сьогодні'], ['default', '15', 'цей місяць'], ['outside', '31', 'сусідній місяць']].map(([state, date, role]) => (
            <div key={state} className="flex flex-col items-center gap-[6px]">
              <CalendarDayNumber state={state} aria-label={`Відкрити ${date} число`}>{date}</CalendarDayNumber>
              <span className="text-[9px] text-[#cfcfcf]">{role}</span>
            </div>
          ))}
        </div>
      </PreviewBlock>


      <PreviewBlock
        title="Комірка дня"
        component="CalendarDayCell"
        description="Цілий день як натискна плитка. У roomy день підсумовує зафіксовані на нього години — це місячна сітка табеля. У compact від дня лишається число і кілька крапок: так місяць вміщується в сім колонок телефона. Сьогодні тримає мʼяке кільце, а не чорнильну заливку числа: заповнена чорним плитка перекричала б цифри всередині себе — тому заливка дісталась обраному дню, тому що на телефоні саме він мусить вигравати."
        filePath="src/components/ui/Calendar/CalendarDayCell.jsx"
        fullWidth
      >
        <div className="grid w-full max-w-[520px] grid-cols-4 gap-[10px]">
          {[['default', '15', 'звичайний'], ['today', '14', 'сьогодні'], ['weekend', '16', 'вихідний'], ['outside', '31', 'сусідній місяць']].map(([state, date, role]) => (
            <CalendarDayCell key={state} state={state} title={role}>
              <span className="text-[12px] font-bold text-ink">{date}</span>
              <span className="text-[10px] font-medium text-muted">{role}</span>
            </CalendarDayCell>
          ))}
        </div>
      </PreviewBlock>
      <PreviewBlock
        title="Місяць у долоні"
        component="CalendarDayCell"
        description="Місячна сітка на телефоні — не зменшений десктоп: у 44 пікселях ширини вміщується число і до трьох крапок за кольорами типів подій, а не назви. Сітка стає вибиралкою — тап відкриває день, і його події показує той самий список, що й «Порядок денний». Обраний день залитий чорнилом, крапки на ньому стають білими."
        filePath="src/app/(app)/calendar/page.js"
      >
        <div className="w-[300px]">
          <div className="mb-[6px] grid grid-cols-7 gap-[3px]">
            {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'].map(name => (
              <span key={name} className="text-center text-[10px] font-bold uppercase text-muted">{name}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-[3px]">
            {PHONE_MONTH.map(day => (
              <CalendarDayCell key={day.date} density="compact" state={day.state}>
                <span className={`text-[13px] font-bold leading-none ${
                  day.state === 'selected' ? 'text-white' : day.state === 'outside' ? 'text-faint' : 'text-ink'
                }`}>{day.date}</span>
                <span className="flex h-[5px] items-center justify-center gap-[3px]">
                  {(day.dots || []).map((color, index) => (
                    <span
                      key={index}
                      className="h-[5px] w-[5px] rounded-full"
                      style={{ backgroundColor: day.state === 'selected' ? 'rgba(255,255,255,0.92)' : color }}
                    />
                  ))}
                </span>
              </CalendarDayCell>
            ))}
          </div>
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Годинний слот"
        component="CalendarHourSlot"
        description="Малює майже нічого — риску згори і найслабший можливий відтінок під курсором — бо його робота бути ціллю, а не обʼєктом: клац створює подію о цій годині. Позиція й висота міряються від сітки, тому приходять inline-стилем: класу «top: девʼята година» не існує. Наведіть, щоб побачити."
        filePath="src/components/ui/Calendar/CalendarHourSlot.jsx"
      >
        <div className="flex gap-[8px]">
          <div className="flex w-[44px] flex-col pt-[1px] text-right">
            {[9, 10, 11].map(hour => (
              <span key={hour} className="h-[44px] pr-[6px] text-[10px] text-faint">{hour}:00</span>
            ))}
          </div>
          <div className="relative h-[132px] w-[200px] rounded-[8px] border border-line bg-white">
            {[0, 1, 2].map(index => (
              <CalendarHourSlot
                key={index}
                label={`Створити подію о ${9 + index}:00`}
                style={{ top: index * 44, height: 44 }}
              />
            ))}
          </div>
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Плюс у комірці"
        description="Єдиний контрол сітки, у якого в кіті вже був родич: IconAction size=&quot;xs&quot; — це 24px коробка з радіусом 7px, рівно те, що комірка малювала руками. Поява при наведенні лишилася на місці виклику: вона належить сітці, а не кнопці — плюс зʼявляється, коли ведеш по дню."
        filePath="src/app/(app)/calendar/page.js"
      >
        <div className="group flex w-[150px] items-center justify-between rounded-[8px] border border-line bg-white p-[7px]">
          <CalendarDayNumber state="today">14</CalendarDayNumber>
          <IconAction
            label="Додати подію"
            icon={Plus}
            size="xs"
            appearance="quiet"
            className="opacity-0 transition-opacity group-hover:opacity-100"
          />
        </div>
      </PreviewBlock>
    </div>
  );
}
