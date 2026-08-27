'use client';
import React, { forwardRef, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useLocalization } from '@/lib/hooks/useLocalization';

// Utility: Get days in month
const getDaysInMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();

// Utility: Format date to YYYY-MM-DD
const formatDate = (date) => {
  if (!date) return '';
  const d = date.toDate ? date.toDate() : new Date(date);
  if (isNaN(d.getTime())) return '';
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
};

// Utility: Parse to Date
const parseDate = (val) => {
  if (!val) return null;
  if (typeof val === 'string' && val.includes('-')) {
    const [year, month, day] = val.split('T')[0].split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  return val.toDate ? val.toDate() : new Date(val);
};

// Rendered through Intl rather than a hardcoded English list — the picker sat
// in an otherwise fully Ukrainian UI and said "January".
const monthFormatter = new Intl.DateTimeFormat('uk-UA', { month: 'long' });
const monthName = date => {
  const label = monthFormatter.format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
};

/**
 * A date field with the kit's own calendar in a portal — not the native one,
 * because a range needs two dates and the platform control cannot express that.
 * Month names come from `Intl` in `uk-UA`; a hardcoded English list is what the
 * first version shipped with.
 *
 * @param {string|Date} props.value Selected date in `single` mode.
 * @param {(value: string) => void} props.onChange Fires with the new date in `single` mode.
 * @param {'single'|'range'} props.mode One date, or a start and an end.
 * @param {string|Date} props.startDate Range start.
 * @param {string|Date} props.endDate Range end.
 * @param {(range: {startDate, endDate}) => void} props.onDateRangeChange Fires with the new range in `range` mode.
 * @param {string|Date} props.minDate Earliest selectable date.
 * @param {number[]} props.yearRange Years offered in the year dropdown.
 * @param {boolean|string} props.error Draws the error border.
 * @param {boolean} props.disabled Unavailable: dimmed and not openable.
 * @param {string} props.placeholder Text shown while empty.
 * @param {boolean} props.compact Denser trigger, for attribute strips.
 * @param {boolean} props.hideIcon Drops the calendar glyph where the context already says "date".
 * @param {'sm'|'md'|'lg'} props.size Control height token.
 * @param {string} props.textTone Colour role for the trigger's text.
 * @param {string} props.composition Named size contract for a specific place, resolved in globals.css.
 * @param {string} props.inputClassName Placement of the inner trigger only.
 * @param {string} props.className Placement in the parent only.
 */
export const DatePicker = forwardRef(({
  value = '',
  onChange,
  error,
  disabled = false,
  placeholder = 'Оберіть дату',
  className = '',
  mode = 'single', // 'single' or 'range'
  startDate = '',
  endDate = '',
  onDateRangeChange,
  inputClassName,
  hideIcon,
  compact = false,
  size = 'lg',
  composition,
  textTone = 'default',
  yearRange = null,
  minDate = '',
  ...props
}, ref) => {
  const { formatDate: formatLocal, getWeekdays, getFirstDayOffset } = useLocalization();
  const WEEKDAYS = getWeekdays();
  const [isOpen, setIsOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(value ? parseDate(value) : null);
  const [rangeStart, setRangeStart] = useState(startDate ? parseDate(startDate) : null);
  const [rangeEnd, setRangeEnd] = useState(endDate ? parseDate(endDate) : null);
  const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0 });
  const containerRef = useRef(null);
  const popupRef = useRef(null);

  // Keep the internal calendar state aligned when a parent switches records or
  // resets a controlled value after saving.
  useEffect(() => {
    const next = value ? parseDate(value) : null;
    setSelectedDate(next);
    if (next) setCurrentMonth(next);
  }, [value]);

  useEffect(() => {
    setRangeStart(startDate ? parseDate(startDate) : null);
    setRangeEnd(endDate ? parseDate(endDate) : null);
  }, [startDate, endDate]);

  // Close calendar on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        containerRef.current
        && !containerRef.current.contains(e.target)
        && !popupRef.current?.contains(e.target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    const updatePopupPosition = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const popupWidth = Math.min(320, window.innerWidth - 16);
      const popupHeight = mode === 'range' ? 410 : 390;
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - popupWidth - 8);
      const hasRoomBelow = window.innerHeight - rect.bottom >= popupHeight;
      const top = hasRoomBelow ? rect.bottom + 8 : Math.max(8, rect.top - popupHeight - 8);
      setPopupPosition({ top, left });
    };
    updatePopupPosition();
    window.addEventListener('resize', updatePopupPosition);
    window.addEventListener('scroll', updatePopupPosition, true);
    return () => {
      window.removeEventListener('resize', updatePopupPosition);
      window.removeEventListener('scroll', updatePopupPosition, true);
    };
  }, [isOpen, mode]);

  const handleDateClick = (day) => {
    if (mode === 'single') {
      const newDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
      setSelectedDate(newDate);
      onChange?.(formatDate(newDate));
      setIsOpen(false);
    } else if (mode === 'range') {
      const newDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
      if (!rangeStart || (rangeStart && rangeEnd)) {
        setRangeStart(newDate);
        setRangeEnd(null);
      } else if (newDate < rangeStart) {
        setRangeEnd(rangeStart);
        setRangeStart(newDate);
        onDateRangeChange?.(formatDate(newDate), formatDate(rangeStart));
      } else {
        setRangeEnd(newDate);
        onDateRangeChange?.(formatDate(rangeStart), formatDate(newDate));
      }
    }
  };

  const daysInMonth = getDaysInMonth(currentMonth);
  const firstDay = getFirstDayOffset(currentMonth);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const yearOptions = yearRange
    ? Array.from(
      { length: Math.max(0, yearRange.max - yearRange.min + 1) },
      (_, index) => yearRange.max - index,
    )
    : [];

  const displayValue = mode === 'single' ?
    (selectedDate ? formatLocal(selectedDate) : '') :
    (rangeStart && rangeEnd ? `${formatLocal(rangeStart)} - ${formatLocal(rangeEnd)}` :
     rangeStart ? formatLocal(rangeStart) : '');

  const singlePresets = [
    { id: 'today', label: 'Сьогодні' },
    { id: 'tomorrow', label: 'Завтра' },
    { id: 'week-end', label: 'Кінець тижня' },
    { id: 'month-end', label: 'Кінець місяця' },
  ];
  const rangePresets = [
    { id: 'today', label: 'Сьогодні' },
    { id: 'this-week', label: 'Цей тиждень' },
    { id: 'this-month', label: 'Цей місяць' },
    { id: 'last-30-days', label: 'Останні 30 днів' },
  ];
  const minimumDate = minDate ? parseDate(minDate) : null;
  minimumDate?.setHours(0, 0, 0, 0);

  const handlePreset = presetId => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (mode === 'single') {
      const date = new Date(today);
      if (presetId === 'tomorrow') date.setDate(date.getDate() + 1);
      if (presetId === 'week-end') date.setDate(date.getDate() + ((7 - date.getDay()) % 7));
      if (presetId === 'month-end') date.setMonth(date.getMonth() + 1, 0);
      if (minimumDate && date < minimumDate) date.setTime(minimumDate.getTime());
      setSelectedDate(date);
      setCurrentMonth(date);
      onChange?.(formatDate(date));
      setIsOpen(false);
      return;
    }

    let start = new Date(today);
    let end = new Date(today);
    if (presetId === 'this-week') {
      const mondayOffset = (today.getDay() + 6) % 7;
      start.setDate(today.getDate() - mondayOffset);
      end = new Date(start);
      end.setDate(start.getDate() + 6);
    } else if (presetId === 'this-month') {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    } else if (presetId === 'last-30-days') {
      start.setDate(today.getDate() - 29);
    }
    setRangeStart(start);
    setRangeEnd(end);
    onDateRangeChange?.(formatDate(start), formatDate(end));
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Input Field */}
      <div className="relative">
        {!hideIcon && (
          <Calendar
            size={14}
            className="absolute left-[12px] top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          />
        )}
        <input
          ref={ref}
          type="text"
          value={displayValue}
          placeholder={placeholder}
          disabled={disabled}
        readOnly
        data-ui-size={size}
        data-ui-composition={composition}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`${inputClassName || `
            ui-control w-full bg-canvas border border-transparent
            text-[13px] focus:border-ink outline-none
            transition-colors placeholder:text-muted
            ${hideIcon ? 'pl-[12px]' : 'pl-[36px]'} pr-[12px] cursor-pointer
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
            ${error ? 'border-danger focus:border-danger bg-danger-soft' : ''}
          `} ${
            textTone === 'danger' ? 'text-danger' : textTone === 'faint' ? 'text-faint' : 'text-ink'
          } ${compact ? 'pr-[22px]' : ''}`}
          {...props}
        />
        {(selectedDate || rangeStart) && !disabled && (
          <button
            type="button"
            aria-label="Очистити дату"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedDate(null);
              setRangeStart(null);
              setRangeEnd(null);
              onChange?.('');
              onDateRangeChange?.('', '');
            }}
            className={`absolute top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full text-muted transition-colors hover:bg-black/[0.04] hover:text-ink ${
              compact ? 'right-0 h-[22px] w-[22px]' : 'right-[8px] h-6 w-6'
            }`}
          >
            <X size={compact ? 12 : 14} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Calendar Popup */}
      {isOpen && !disabled && typeof document !== 'undefined' && createPortal(
        <div
          ref={popupRef}
          data-qt-floating-overlay
          className="fixed z-[1100] w-[min(320px,calc(100vw-16px))] rounded-[12px] border border-line bg-white p-4 shadow-[0_16px_40px_rgba(0,0,0,0.16)]"
          style={{ top: popupPosition.top, left: popupPosition.left }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              aria-label="Попередній місяць"
              onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
              className="p-1 hover:bg-canvas rounded-[6px] transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="flex items-center gap-2">
              <h3 className="text-[14px] font-bold text-ink">
                {monthName(currentMonth)}
              </h3>
              {yearRange ? (
                <select
                  aria-label="Рік"
                  value={currentMonth.getFullYear()}
                  onChange={event => setCurrentMonth(new Date(Number(event.target.value), currentMonth.getMonth(), 1))}
                  className="h-7 rounded-[8px] border border-line bg-canvas px-2 text-[12px] font-bold text-ink outline-none focus:border-ink"
                >
                  {yearOptions.map(year => <option key={year} value={year}>{year}</option>)}
                </select>
              ) : (
                <span className="text-[14px] font-bold text-ink">{currentMonth.getFullYear()}</span>
              )}
            </div>
            <button
              type="button"
              aria-label="Наступний місяць"
              onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
              className="p-1 hover:bg-canvas rounded-[6px] transition-colors"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {WEEKDAYS.map(day => (
              <div key={day} className="text-center text-[11px] font-bold text-muted py-1">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {days.map(day => {
              const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
              const isSelected = selectedDate && formatDate(date) === formatDate(selectedDate);
              const isRangeStart = rangeStart && formatDate(date) === formatDate(rangeStart);
              const isRangeEnd = rangeEnd && formatDate(date) === formatDate(rangeEnd);
              const isInRange = rangeStart && rangeEnd && date >= rangeStart && date <= rangeEnd;
              const isBeforeMinimum = minimumDate && date < minimumDate;

              return (
                <button
                  key={day}
                  type="button"
                  disabled={Boolean(isBeforeMinimum)}
                  aria-pressed={Boolean(isSelected || isRangeStart || isRangeEnd)}
                  onClick={() => handleDateClick(day)}
                  className={`
                    p-1 text-[12px] font-semibold rounded-[6px] transition-all
                    ${isBeforeMinimum
                      ? 'cursor-not-allowed text-faint opacity-35'
                      : isSelected || isRangeStart || isRangeEnd
                      ? 'bg-ink text-white'
                      : isInRange
                      ? 'bg-line text-ink'
                      : 'text-ink hover:bg-canvas'
                    }
                  `}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Quick select presets */}
          <div className="border-t border-line mt-4 pt-3">
            <p className="text-[10px] font-bold text-muted uppercase mb-2">Швидкий вибір</p>
            <div className="grid grid-cols-2 gap-2">
              {(mode === 'single' ? singlePresets : rangePresets).map(preset => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handlePreset(preset.id)}
                  className="text-[11px] font-bold text-ink hover:bg-canvas rounded-[6px] py-1 transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
});
DatePicker.displayName = 'DatePicker';
export default DatePicker;
