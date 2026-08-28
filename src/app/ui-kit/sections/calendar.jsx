'use client';
import { CalendarDayNumber, CalendarDayCell } from '@/components/ui';
import { PreviewBlock } from '../preview';

export default function CalendarSection() {
  return (
    <div className="flex flex-col gap-[32px]">
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
        description="Цілий день як натискна плитка — місячна сітка табеля, де день підсумовує зафіксовані на нього години. Сьогодні тримає мʼяке кільце, а не чорнильну заливку числа: заповнена чорним плитка перекричала б цифри всередині себе."
        filePath="src/components/workspace/TimesheetTab.jsx"
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
    </div>
  );
}
