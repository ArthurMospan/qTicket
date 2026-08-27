const clean = value => typeof value === 'string' ? value.trim() : '';

function dateValue(value) {
  if (!value) return '';
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('uk-UA', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';
}

function minutesValue(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return [hours ? `${hours} год` : '', rest ? `${rest} хв` : ''].filter(Boolean).join(' ');
}

export function buildTaskAiPrompt({
  issue = {},
  projectName = '',
  statusName = '',
  priorityName = '',
  typeName = '',
  assigneeNames = [],
  taskUrl = '',
} = {}) {
  // `subtasks` is the legacy lightweight checklist field. Real child issues
  // have their own documents and are intentionally not flattened into this
  // prompt as if they were checklist rows.
  const checklistItems = Array.isArray(issue.subtasks) ? issue.subtasks : [];
  const labels = Array.isArray(issue.labelIds) ? issue.labelIds : [];
  const context = [
    ['Проєкт', projectName],
    ['Ключ', issue.issueKey],
    ['Тип', typeName || issue.type],
    ['Статус', statusName || issue.status || issue.columnId],
    ['Пріоритет', priorityName || issue.priority],
    ['Виконавці', assigneeNames.filter(Boolean).join(', ')],
    ['Дедлайн', dateValue(issue.dueDate)],
    ['Оцінка', minutesValue(issue.estimateMinutes)],
    ['Мітки', labels.join(', ')],
    ['Посилання', taskUrl],
  ].filter(([, value]) => clean(String(value || '')));

  const sections = [
    'Допоможи якісно виконати наступну задачу. Спочатку коротко переформулюй очікуваний результат, потім запропонуй план виконання. Якщо контексту недостатньо — не вигадуй факти, а постав конкретні уточнювальні запитання.',
    `## Задача\n${clean(issue.title) || 'Без назви'}`,
  ];

  if (context.length) {
    sections.push(`## Контекст\n${context.map(([label, value]) => `- ${label}: ${value}`).join('\n')}`);
  }
  if (clean(issue.description)) sections.push(`## Опис\n${clean(issue.description)}`);
  if (checklistItems.length) {
    sections.push(`## Чекліст\n${checklistItems.map(item => `- [${item?.done ? 'x' : ' '}] ${clean(item?.title)}`).join('\n')}`);
  }

  sections.push([
    '## Формат відповіді',
    '1. Розуміння задачі та критерії готовності.',
    '2. Ризики, залежності й відсутні дані.',
    '3. Покроковий план.',
    '4. Конкретний результат або перший готовий варіант.',
  ].join('\n'));

  return sections.join('\n\n');
}
