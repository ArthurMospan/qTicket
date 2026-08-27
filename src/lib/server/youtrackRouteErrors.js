import 'server-only';

import { NextResponse } from 'next/server';
import { routeErrorResponse } from '@/lib/server/apiErrors';

const SAFE_INPUT_PREFIXES = [
  'Вкажіть ',
  'Некоректн',
  'Оберіть ',
  'Один із ',
  'Один з ',
  'Обраний статус ',
  'Статус QuickTeam ',
  'Локальні ',
  'Ліміт ',
  'YouTrack має ',
  'YouTrack не підключено',
  'Підключення YouTrack пошкоджене',
  'Імпорт не знайдено',
  'Імпорт скасовано',
  'Імпорт запустив',
];

export function youTrackRouteErrorResponse(error, { context, fallbackMessage }) {
  const message = String(error?.message || '');
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return NextResponse.json({ error: 'YouTrack не відповів вчасно. Спробуйте ще раз.' }, { status: 504 });
  }
  if (error?.status === 401 || error?.status === 403) {
    return NextResponse.json({
      error: 'YouTrack відхилив токен або акаунт не має доступу до потрібних даних.',
    }, { status: 400 });
  }
  if (Number.isInteger(error?.status) && error.status >= 400) {
    return NextResponse.json({
      error: `YouTrack API повернув помилку ${error.status}. Перевірте адресу, права токена і доступ до проєктів.`,
    }, { status: 502 });
  }
  if (message === 'Invalid URL') {
    return NextResponse.json({ error: 'Вкажіть повну HTTPS-адресу YouTrack.' }, { status: 400 });
  }
  if (SAFE_INPUT_PREFIXES.some(prefix => message.startsWith(prefix))) {
    const status = message === 'Імпорт не знайдено' ? 404
      : message === 'Імпорт скасовано' ? 409
        : message.startsWith('Ліміт ') ? 403
          // Not 400: the request is well formed and the caller is who they say
          // they are — they simply are not this import's author.
          : message.startsWith('Імпорт запустив') ? 403
            : 400;
    return NextResponse.json({ error: message }, { status });
  }
  return routeErrorResponse(error, { context, fallbackMessage });
}
