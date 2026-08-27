'use client';
import { useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button, StatusTransitionPicker, TaskCounters, TaskIdentity, TaskListCard, TaskListView, TaskTableView } from '@/components/ui';
import AgileBoard from '@/components/workspace/AgileBoard';
import TaskRow from '@/components/ui/TaskManagement/TaskRow';
import { DEFAULT_STATUSES, useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { PreviewBlock } from '../preview';

export default function TaskCRMSection() {
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  // The catalogue holds the table's arrangement the same way the address does
  // in the product: the component never keeps a copy of it.
  const [tableSort, setTableSort] = useState({ sort: 'manual', dir: 'asc' });
  const [tableColumns, setTableColumns] = useState(['key', 'title', 'status', 'assignees', 'priority', 'due']);
  const toggleTableColumn = columnId => setTableColumns(current => (
    current.includes(columnId)
      ? current.filter(id => id !== columnId)
      : [...current, columnId]
  ));
  const { statuses } = useWorkflowConfig();
  const firstStatusId = statuses[0]?.id || DEFAULT_STATUSES[0].id;
  const secondStatusId = statuses[1]?.id || firstStatusId;
  const thirdStatusId = statuses[2]?.id || secondStatusId;
  const lastStatusId = statuses.at(-1)?.id || thirdStatusId;
  const demoMembers = [
    { uid: '1', name: 'Артур Моспан', initials: 'АМ', bg: '#6366f1' },
    { uid: '2', name: 'Іван Петренко', initials: 'ІП', bg: '#10b981' }
  ];

  const demoLabels = [
    { id: 'frontend', label: 'Фронтенд', color: '#3b82f6' },
    { id: 'design', label: 'Дизайн', color: '#db2777' },
    { id: 'bug', label: 'Баг', color: '#ef4444' }
  ];

  const demoSprints = [
    { id: 'sprint-1', name: 'Спринт 12' }
  ];

  const task1 = {
    id: 't1',
    issueKey: 'QUI-41',
    projectId: 'ui-kit-project',
    columnId: firstStatusId,
    title: "Редизайн головної сторінки з новими компонентами",
    priority: "high",
    type: "feature",
    assigneeIds: ['1', '2'],
    dueDate: new Date('2026-07-13T12:00:00Z'),
    subtasks: [{ id: '1', title: 'Кнопки', done: true }, { id: '2', title: 'Інпути', done: false }],
    labelIds: ['frontend', 'design'],
    sprintId: 'sprint-1'
  };

  const task2 = {
    id: 't2',
    issueKey: 'QUI-42',
    projectId: 'ui-kit-project',
    columnId: secondStatusId,
    title: "Критична помилка при авторизації користувачів через Google",
    priority: "critical",
    type: "bug",
    assigneeIds: ['2'],
    dueDate: new Date('2026-07-11T12:00:00Z'), // overdue in this static demo
    subtasks: [],
    labelIds: ['bug']
  };

  const task3 = {
    id: 't3',
    issueKey: 'QUI-43',
    projectId: 'ui-kit-project',
    columnId: thirdStatusId,
    title: "Написати юніт-тести для нового контролера авторизації",
    priority: "low",
    type: "task",
    parentIssueId: 't1',
    assigneeIds: [],
    dueDate: null,
    subtasks: []
  };

  const task4 = {
    id: 't4',
    issueKey: 'QUI-44',
    projectId: 'ui-kit-project',
    columnId: lastStatusId,
    title: "Інтеграція Stripe для автоматичного прийому платіжних карток",
    priority: "medium",
    type: "feature",
    assigneeIds: ['1'],
    dueDate: null,
    subtasks: [{ id: '1', done: true }, { id: '2', done: true }, { id: '3', done: true }],
    hasUnreadChat: true
  };

  const task5 = {
    id: 't5',
    issueKey: 'QUI-45',
    projectId: 'ui-kit-project',
    columnId: firstStatusId,
    title: "Додати кнопку швидкого експорту звітів аналітики у CSV та PDF",
    priority: "low",
    type: "feature",
    assigneeIds: ['2'],
    dueDate: new Date('2026-07-14T12:00:00Z'),
    subtasks: [],
    labelIds: ['frontend']
  };
  const demoIssues = [task1, task2, task3, task4, task5];
  // Fourteen rows out of five, so the catalogue shows the state that matters:
  // the card stops at ten and offers the rest, instead of drawing whatever
  // length of list it happens to be handed.
  const demoLongList = Array.from({ length: 14 }, (_, index) => ({
    ...demoIssues[index % demoIssues.length],
    id: `kit-long-${index}`,
    issueKey: `QT-${200 + index}`,
  }));

  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock
        title="Status Transition Picker — точний статус після drop"
        description="На крос-проєктній дошці користувач кидає картку в спільну категорію. Якщо у її проєкті там кілька реальних колонок, центральний діалог повторює вигляд дошки: показує їхні назви й кольори, дає обрати точну колонку та підтвердити перенесення. За одного кандидата він не відкривається взагалі."
        filePath="src/components/ui/TaskManagement/StatusTransitionPicker.jsx"
        component="StatusTransitionPicker"
      >
        <Button style="secondary" size="lg" onClick={() => setStatusPickerOpen(true)}>
          Перенести QUI-41 в «У роботі»
        </Button>
        {statusPickerOpen ? (
          <StatusTransitionPicker
            isOpen
            issue={task1}
            project={{ id: 'ui-kit-project', name: 'QuickTeam' }}
            categoryLabel="У роботі"
            issues={demoIssues}
            members={demoMembers}
            labels={demoLabels}
            sprints={demoSprints}
            statuses={[
              { id: 'development', label: 'Розробка', color: '#6366f1' },
              { id: 'code-review', label: 'Код-ревʼю', color: '#a855f7' },
              { id: 'qa', label: 'QA', color: '#f59e0b' },
            ]}
            onSelect={() => setStatusPickerOpen(false)}
            onClose={() => setStatusPickerOpen(false)}
          />
        ) : null}
      </PreviewBlock>

      <PreviewBlock
        title="Task Identity — ключ, батьківське завдання, проєкт"
        description="Порядок від завдання назовні: свій ключ → під ким висить → у якому проєкті. Усі три моноширинні: два з них ідентифікатори, а третій шрифт на рядку в 10px читався як шов, а не як різниця. Розрізняються вагою і кольором — вагу має лише власний ключ, решта контекст. Спільний line-height на всі три, інакше кожен рахує свою висоту рядка від свого шрифту і назва проєкту сидить нижче за ключі. Іконка справжня, а не символ «↳», у якого немає однакових метрик у різних шрифтах. Ключ не вигадується: завдання без ключа не показує нічого замість «PRE-a3f2» зі шматка id документа. Завдання в категорії «Готово» показує свій ключ закресленим — закреслюється саме ключ, ручка, за яку більше не треба братися, а не назва: назва лишається правдою і для зробленого завдання."
        filePath="src/components/ui/TaskManagement/TaskIdentity.jsx"
      >
        <div className="flex flex-col gap-3">
          <TaskIdentity issue={{ issueKey: 'QT-142' }} />
          <TaskIdentity issue={{ issueKey: 'QT-142' }} projectName="QuickTeam" showProjectName />
          <TaskIdentity
            issue={{ issueKey: 'QT-142' }}
            projectName="QuickTeam"
            showProjectName
            parentIssue={{ issueKey: 'QT-100', title: 'Переробити календар' }}
          />
          {/* A legacy `WS-` key keeps its number and takes the project's prefix. */}
          <TaskIdentity issue={{ issueKey: 'WS-17' }} projectName="QuickTeam" showProjectName />
          {/* No key at all — the title below it is the task's name. */}
          <TaskIdentity issue={{}} projectName="QuickTeam" showProjectName />
          {/* «Готово»: the key is struck, the rest of the line is not. */}
          <TaskIdentity issue={{ issueKey: 'QT-138' }} projectName="QuickTeam" showProjectName done />
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Task Counters — вкладення, згадки, повідомлення, крапка"
        description="Три лічильники одного вигляду й одна крапка «є нове», завжди останньою. Згадка — такий самий лічильник, а не пілюля: це той самий тип факту (скільки чогось є), і відрізняється лише кольором, бо з трьох саме вона адресована особисто тобі. Крапка одна на картку і покриває будь-яку активність — раніше один коментар засвічував дві однакові крапки в різних кутах картки."
        filePath="src/components/ui/TaskManagement/TaskCounters.jsx"
      >
        <div className="flex flex-col gap-3">
          <TaskCounters attachments={2} messages={12} />
          <TaskCounters attachments={1} mentions={3} messages={12} unread />
          <TaskCounters messages={4} unread size="sm" />
          <TaskCounters unread />
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Task Row (List View)"
        description="Один shared row для project і cross-project контекстів; назву проєкту вмикає лише semantic prop showProjectName. Рядок має дві компоновки, і друга — не перша з flex-wrap: від md це один рядок, нижче md — маленька картка, де ім’я, назва й те, що задача несе, отримують по лінії. Звузьте вікно — назва перестане тиснутись у третину ширини, спринт і мітки перестануть обрізатись об край, а цифри піднімуться з 9px до читабельних 11px."
        filePath="src/components/ui/TaskManagement/TaskRow.jsx"
        fullWidth
      >
        <div className="bg-[#f4f4f5] p-6 rounded-[16px] flex flex-col gap-[8px]">
          <p className="ui-type-eyebrow uppercase tracking-wider text-muted">Project context — назва проєкту прихована</p>
          <TaskRow
            issue={task1}
            allIssues={demoIssues}
            members={demoMembers}
            labels={demoLabels}
            sprints={demoSprints}
            projectName="QuickTeam"
          />
          <p className="ui-type-eyebrow mt-2 uppercase tracking-wider text-muted">Cross-project context — назва проєкту видима</p>
          <TaskRow
            issue={task2}
            allIssues={demoIssues}
            members={demoMembers}
            labels={demoLabels}
            sprints={demoSprints}
            projectName="QuickTeam"
            showProjectName
          />
          <TaskRow
            issue={task3}
            allIssues={demoIssues}
            members={demoMembers}
            labels={demoLabels}
            sprints={demoSprints}
            projectName="QuickTeam"
            showProjectName
          />
          <TaskRow
            issue={task4}
            allIssues={demoIssues}
            members={demoMembers}
            labels={demoLabels}
            sprints={demoSprints}
            projectName="QuickTeam"
            showProjectName
          />
          <TaskRow
            issue={task5}
            allIssues={demoIssues}
            members={demoMembers}
            labels={demoLabels}
            sprints={demoSprints}
            projectName="QuickTeam"
            showProjectName
          />
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Task List View — живий shared organism"
        description="Саме цей organism рендерить обидва списки: hiddenGroupIds збирає відповідні задачі в секцію «Приховані», а showProjectName додає проєкт лише у cross-project view. Кожну секцію можна згорнути кнопкою праворуч (той самий ghost icon, що згортає колонку канбану); розділювальної лінії під заголовком немає — секції відділяє відступ."
        filePath="src/components/ui/TaskManagement/TaskListView.jsx"
        fullWidth
      >
        <TaskListView
          issues={demoIssues}
          allIssues={demoIssues}
          members={demoMembers}
          labels={demoLabels}
          sprints={demoSprints}
          projects={[{ id: 'ui-kit-project', name: 'QuickTeam' }]}
          showProjectName
          hiddenGroupIds={[lastStatusId]}
          onBulkUpdate={() => {}}
          canArchive
        />
      </PreviewBlock>

      <PreviewBlock
        title="Task List View — групування за категоріями"
        description="groupBy=&quot;category&quot; — той самий organism на крос-проєктному списку «Мої завдання». Секції тут не статуси, а спільні категорії, тому назви статусів різних проєктів не змагаються за одну секцію."
        filePath="src/components/ui/TaskManagement/TaskListView.jsx"
        fullWidth
      >
        <TaskListView
          issues={demoIssues}
          allIssues={demoIssues}
          members={demoMembers}
          labels={demoLabels}
          sprints={demoSprints}
          projects={[{ id: 'ui-kit-project', name: 'QuickTeam' }]}
          showProjectName
          groupBy="category"
          onBulkUpdate={() => {}}
          canArchive
        />
      </PreviewBlock>

      <PreviewBlock
        title="Task Table View — таблиця з редагуванням у клітинці"
        description="Третє прочитання тих самих задач. Шапка сіра з лінією-тінню — межа клітинки при border-collapse належить таблиці й не їде разом із примерзлою шапкою, тому лінія зникала при скролі. Колонка ID і назва примерзають ліворуч. Клік по заголовку: ▲ → ▼ → назад до порядку дошки; шеврон поруч (видно на наведенні) групує саме за цією колонкою — групування належить колонці, а не рядку фільтрів. Іконка в кутовій клітинці вмикає колонки. Клітинка відкриває той самий kit-контрол, що і всюди, з композицією table-cell, щоб рядок не підстрибував; рівно один за раз — контрол у кожній клітинці повісив би по слухачу документа на клітинку. Клік по ID відкриває модалку швидкого перегляду."
        filePath="src/components/ui/TaskManagement/TaskTableView.jsx"
        component="TaskTableView"
        fullWidth
      >
        <div className="h-[420px] min-w-0">
          <TaskTableView
            issues={demoIssues}
            allIssues={demoIssues}
            members={demoMembers}
            labels={demoLabels}
            sprints={demoSprints}
            projectId="ui-kit-project"
            columns={tableColumns}
            sort={tableSort.sort}
            dir={tableSort.dir}
            onSortChange={setTableSort}
            onColumnsChange={toggleTableColumn}
            onOpenIssue={() => {}}
            onUpdateIssue={async () => {}}
            onBulkUpdate={() => {}}
            canArchive
          />
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Task Table View — без групування, свій набір колонок"
        description="group=&quot;none&quot; знімає смуги й лишає одне полотно — вигляд для масової чистки беклогу. columns задає видимі колонки; «ID» і «Назву» вимкнути не можна, бо рядок, який неможливо впізнати, — не рядок. Порядок колонок канонічний, а не той, у якому їх перелічили: у посиланні їде набір, а не розкладка. Таблиця без права на запис (архівний проєкт) просто не відкриває клітинок."
        filePath="src/components/ui/TaskManagement/TaskTableView.jsx"
        fullWidth
      >
        <div className="h-[340px] min-w-0">
          <TaskTableView
            issues={demoIssues}
            allIssues={demoIssues}
            members={demoMembers}
            labels={demoLabels}
            sprints={demoSprints}
            projectId="ui-kit-project"
            sort="priority"
            dir="asc"
            columns={['type', 'title', 'labels', 'estimate', 'subtasks', 'due']}
            onSortChange={() => {}}
          />
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Task List Card — плоский список задач"
        description="Один вигляд для всіх списків задач в аналітиці: «Прострочені» в Огляді, «Поточний фокус» і «Завершено» в Команді, «Нещодавно закриті» в Продуктивності. На відміну від Task List View тут немає групування за статусом — набір уже визначив той, хто його показує. Рядки ті самі TaskRow, тож задача клікабельна скрізь однаково. Картка показує десять рядків і пропонує решту: раніше вона малювала все, що їй дали, а «Усі задачі» одного учасника — це буквально всі його задачі за весь час. Лічильник біля заголовка завжди повний, тож число не розходиться з тим, що за ним."
        filePath="src/components/ui/TaskManagement/TaskListCard.jsx"
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <TaskListCard
            title="Прострочені"
            icon={AlertTriangle}
            iconClassName="text-red-500"
            issues={demoLongList}
            allIssues={demoLongList}
            members={demoMembers}
            labels={demoLabels}
            sprints={demoSprints}
            projects={[{ id: 'ui-kit-project', name: 'QuickTeam' }]}
          />
          <TaskListCard
            title="Нещодавно закриті завдання"
            icon={CheckCircle2}
            iconClassName="text-emerald-600"
            issues={[]}
            members={demoMembers}
            projects={[{ id: 'ui-kit-project', name: 'QuickTeam' }]}
            emptyText="За вказаний період завдань не закрито"
          />
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Agile Board — живий shared organism"
        description="Та сама Kanban-дошка використовується в проєкті та в «Мої завдання». Відмінності контексту задаються явними props, а не другою копією верстки."
        filePath="src/components/workspace/AgileBoard.jsx"
        fullWidth
      >
        <div className="h-[520px] min-w-0 overflow-hidden rounded-[16px] bg-white p-4">
          <AgileBoard
            issues={demoIssues}
            allIssues={demoIssues}
            members={demoMembers}
            projects={[{ id: 'ui-kit-project', name: 'QuickTeam' }]}
            projectId="ui-kit-project"
            project={{ id: 'ui-kit-project', name: 'QuickTeam', hiddenColumns: [] }}
            sprints={demoSprints}
            onAddIssue={() => {}}
            onMoveIssue={() => {}}
            onBulkUpdate={() => {}}
            canArchive
          />
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Agile Board — колонки-категорії"
        description="groupBy=&quot;category&quot; — режим «Моїх завдань». Колонки не статуси, а пʼять спільних категорій. Великі колонки віртуалізують лише DOM поза viewport, але не ховають задачі за кнопкою."
        filePath="src/components/workspace/AgileBoard.jsx"
        fullWidth
      >
        <div className="h-[520px] min-w-0 overflow-hidden rounded-[16px] bg-white p-4">
          <AgileBoard
            issues={demoIssues}
            allIssues={demoIssues}
            members={demoMembers}
            projects={[{ id: 'ui-kit-project', name: 'QuickTeam' }]}
            projectId="ui-kit-my"
            sprints={demoSprints}
            showProjectName
            groupBy="category"
            showHiddenLane
            onAddIssue={() => {}}
            onMoveIssue={() => {}}
            onBulkUpdate={() => {}}
            canArchive
          />
        </div>
      </PreviewBlock>
    </div>
  );
}
