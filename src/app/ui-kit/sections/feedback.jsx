'use client';
import { useState } from 'react';
import Button from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import Surface from '@/components/ui/Surface';
import { Alert, ConnectionBanner, LoadingSpinner, EmptyState, PlanDowngradeDialog, PlanGate, PlanLimitRail, PlanMark, PlanUpgradeDialog } from '@/components/ui';
import { Toast } from '@/components/ui/Feedback/Toast';
import { User, Folder, Plug } from 'lucide-react';
import { ChatIcon } from '@/lib/design/icons';
import { planDowngradeNotice, planLimitNotice } from '@/lib/utils/plans.mjs';
import { PreviewBlock } from '../preview';

export default function FeedbackSection() {
  const [qtPlusProject, setQtPlusProject] = useState('');
  const [toast, setToast] = useState(null);
  const [offline, setOffline] = useState(false);
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [downgradeOpen, setDowngradeOpen] = useState(false);
  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock title="Alerts" component="Alert" description="Компонент сповіщень. Має скруглення L3 (8px) відповідно до токенів." fullWidth>
        <div className="flex flex-col gap-[12px] max-w-[600px]">
          <Alert variant="success" title="Операція успішна">Проєкт успішно створено та додано до бази даних.</Alert>
          <Alert variant="info" title="Потребує уваги">Будь ласка, перевірте правильність введених даних.</Alert>
          <Alert variant="warning" title="Попередження">Термін виконання завдання спливає сьогодні.</Alert>
          <Alert variant="error" title="Не вдалося завантажити проєкти">Спробуйте оновити сторінку.</Alert>
        </div>
      </PreviewBlock>

      <PreviewBlock title="Loading Spinner" description="Анімований спіннер для станів завантаження.">
        <div className="flex items-center gap-[24px]">
          <LoadingSpinner size="sm" />
          <LoadingSpinner size="md" />
        </div>
      </PreviewBlock>

      {/* Toast reported zero usages for months because WorkspaceToastHost
          imports it under a different name (`UiToast`), and the scan matched on
          the exported one. It is on every screen in the product. */}
      <PreviewBlock
        title="Toast"
        component="Toast"
        description="Спливне сповіщення, яке продукт показує через WorkspaceToastHost — той самий компонент, лише під локальним іменем UiToast. Рендериться в портал поверх усього; тут показані всі варіанти без автозакриття."
        filePath="src/components/WorkspaceToastHost.jsx"
        fullWidth
      >
        <div className="flex flex-wrap gap-2">
          {['success', 'error', 'warning', 'info', 'loading'].map(variant => (
            <Button key={variant} style="secondary" size="md" onClick={() => setToast(variant)}>
              {variant}
            </Button>
          ))}
        </div>
        {toast && (
          <Toast
            key={toast}
            variant={toast}
            message={`Toast variant="${toast}"`}
            action="Скасувати"
            onAction={() => setToast(null)}
            // Тільки помилка має цю кнопку — і саме вона тримається довше
            // (9 с проти 3.5 с), бо її треба встигнути прочитати й вирішити.
            onReport={() => setToast(null)}
            autoClose={false}
            onClose={() => setToast(null)}
          />
        )}
      </PreviewBlock>

      <PreviewBlock
        title="Empty States — продуктові контексти"
        description="Не вигадані картки: ліворуч точний empty state головної сторінки, праворуч точний empty state workspace-чату."
        filePath="src/components/ui/Feedback/EmptyState.jsx"
        fullWidth
      >
        <div className="grid w-full grid-cols-1 gap-[16px] lg:grid-cols-2">
          <Surface preset="panel" padding="md" className="w-full">
            <EmptyState
              icon={Folder}
              title="Ще немає проєктів"
              description="Створіть перший проєкт, щоб організувати завдання та роботу команди."
              action="Створити проєкт"
              onAction={() => {}}
              context="page"
            />
          </Surface>
          <div className="flex min-h-[328px] flex-1 items-center justify-center rounded-[16px] bg-canvas">
            <EmptyState
              icon={ChatIcon}
              title="Ще немає повідомлень"
              description="Почніть розмову! 👋"
              context="page"
            />
          </div>
        </div>
        <div className="mt-[16px] grid w-full grid-cols-1 gap-[16px] lg:grid-cols-2">
          <EmptyState
            icon={User}
            title="Нікого не знайдено"
            description="Спробуйте змінити пошуковий запит."
            density="compact"
          />
          <EmptyState
            icon={ChatIcon}
            title="Ще немає повідомлень"
            description="Почніть обговорення завдання з командою."
            context="flexible"
          />
          <EmptyState
            icon={Plug}
            title="Підключіть QuickTeam+"
            description="Підключіть акаунт, щоб працювати з матеріалами та чатом."
            action="Підключити QuickTeam+"
            onAction={() => {}}
            context="inset"
            surface="card"
          />
          <EmptyState
            icon={Plug}
            title="Оберіть проєкт QuickTeam+"
            description="Привʼяжіть клієнтський проєкт, щоб бачити етапи, матеріали та чат."
            context="inset"
            surface="card"
          >
            <div className="mx-auto flex w-full max-w-[420px] flex-col gap-2 sm:flex-row">
              <Select
                value={qtPlusProject}
                onChange={setQtPlusProject}
                options={[
                  { value: 'brand', label: 'Brand redesign' },
                  { value: 'mobile', label: 'Mobile application' },
                ]}
                placeholder="Оберіть проєкт QuickTeam+"
                className="min-w-0 flex-1 text-left"
              />
              <Button style="primary" size="lg" disabled={!qtPlusProject}>Привʼязати</Button>
            </div>
          </EmptyState>
        </div>
      </PreviewBlock>
      <PreviewBlock
        title="Звʼязок"
        component="ConnectionBanner"
        description="Постійна смуга чесно попереджає, що без мережі зміни зараз не зберігаються."
        fullWidth
      >
        <Button style="secondary" onClick={() => setOffline(value => !value)}>
          {offline ? 'Повернути звʼязок' : 'Імітувати офлайн'}
        </Button>
        <ConnectionBanner offline={offline} />
      </PreviewBlock>

<PreviewBlock
        title="PlanLimitRail — стеля тарифу, сказана внизу рейки"
        component="PlanLimitRail"
        description="Корона біля контрола відповідає тому, хто вже тягнеться саме до цього контрола. На питання «чому нічого не створюється» вона відповісти не може: людина, яка його ставить, не дивиться на жоден конкретний контрол. Раніше це була смуга над панеллю контенту — і кожен екран під нею був на її висоту нижчим, а два екрани, що міряють себе від вікна, ставали вищими за місце, яке мають. Тепер це рядок у підвалі сайдбару: він нічого не посуває і зникає разом з умовою. Усі кольори намішані з --sb-text, тому рядок читається на чорній рейці, на білій і на будь-якій брендованій; жовтий — тільки гліф, бо сенс несуть слова поруч."
        filePath="src/components/ui/Feedback/PlanLimitRail.jsx"
        fullWidth
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {/* The two rails the product actually ships, so the mix against
              `--sb-text` is judged on both rather than on the one the
              catalogue happens to be drawn on. */}
          <div className="flex flex-col gap-3 rounded-[16px] bg-ink p-[16px] [--sb-muted:#a3a3a3] [--sb-text:#ffffff]">
            <PlanLimitRail notice={planLimitNotice('free', 'projects', 3)} onOpen={() => {}} />
            <PlanLimitRail notice={planLimitNotice('free', 'members', 5)} extra={2} onOpen={() => {}} />
            <PlanLimitRail notice={planLimitNotice('free', 'projects', 3)} collapsed onOpen={() => {}} />
          </div>
          <div className="flex flex-col gap-3 rounded-[16px] bg-canvas p-[16px] [--sb-muted:#6b6b6b] [--sb-text:#1f1f1f]">
            <PlanLimitRail notice={planLimitNotice('free', 'projects', 3)} onOpen={() => {}} />
            <PlanLimitRail notice={planLimitNotice('free', 'members', 5)} extra={2} onOpen={() => {}} />
            <PlanLimitRail notice={planLimitNotice('free', 'projects', 3)} collapsed onOpen={() => {}} />
          </div>
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="PlanDowngradeDialog — питання перед тим, як щось вимкнеться"
        component="PlanDowngradeDialog"
        description="Це був confirm із суцільним текстом і двома однаковими кнопками — тобто форма для «видалити спринт?», одного факту й одного рішення. Тут фактів шестеро, двох різних видів, і жоден не руйнівний: перемикач, який перестане працювати, малюється замком, а число, яке вже за новою стелею, — цифрою праворуч і рядком про те, що буде з надлишком. Кнопки не рівні навмисно: людина за один клік від того, щоб вимкнути пʼять речей, і пара однакових кнопок не ставить питання, а ділить його навпіл. Лишитись — заповнена кнопка й фокус; понизити — тиха кнопка, яка каже, що робить. Це не темний патерн: пониження за один клік у будь-якому разі, воно ніде не сховане й оборотне — про що й каже останній рядок."
        filePath="src/components/ui/Feedback/PlanDowngradeDialog.jsx"
        fullWidth
      >
        <Button style="secondary" onClick={() => setDowngradeOpen(true)}>Показати діалог</Button>
        <PlanDowngradeDialog
          isOpen={downgradeOpen}
          notice={planDowngradeNotice('pro', 'free', { projects: 12, members: 20, aiCalls: 30 })}
          onStay={() => setDowngradeOpen(false)}
          onConfirm={() => setDowngradeOpen(false)}
        />
      </PreviewBlock>

      <PreviewBlock
        title="PlanMark — корона біля того, куди тариф не пускає"
        component="PlanMark"
        description="Стоїть біля контрола, а не в прайслисті: прайс уже сказав, що входить у тариф, а корисне місце для позначки — момент, коли людина тягнеться до перемикача і він не рухається. Була чорною зірочкою — тим самим гліфом, яким кожен продукт позначає «улюблене», — і не клікалась, тож відповідь зупинялась на підказці. Тепер відкриває прайслист на тій стелі, що заважає."
        filePath="src/components/ui/DataDisplay/PlanMark.jsx"
      >
        <div className="flex flex-col gap-[10px]">
          <span className="flex items-center gap-2 text-[13px] text-ink">
            Власний брендинг
            <PlanMark capabilityId="branding" label="тільки в Lite і Pro" />
          </span>
          <span className="flex items-center gap-2 text-[13px] text-ink">
            Пріоритетна підтримка
            <PlanMark capabilityId="priority-support" label="тільки в Pro" />
          </span>
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="PlanGate — цілий екран, якого немає в тарифі"
        component="PlanGate"
        description="Корона — це позначка біля контрола. Це той самий випадок на розмір більший: не перемикач усередині екрана, а сам екран — «Інтеграції», «Перенесення даних», вкладка рахунку. Свідомо не реклама: назва, один рядок про те, що це, і одна кнопка. Замилений скріншот фічі за пейволом виглядає як знущання і до того ж бреше — розмиті пікселі там чужі. Формулювання беруться з реєстру, тому екран не може описати можливість інакше, ніж прайслист, який її продає."
        filePath="src/components/ui/Feedback/PlanGate.jsx"
        fullWidth
      >
        <PlanGate capabilityId="integrations">
          <p className="text-[13px] text-muted">Тут був би екран інтеграцій.</p>
        </PlanGate>
      </PreviewBlock>

      <PreviewBlock
        title="PlanUpgradeDialog — що відкриває корона"
        component="PlanUpgradeDialog"
        description="Тіло діалогу — той самий PlanCards, що в налаштуваннях і в онбордингу. У цьому і суть: діалог, який цитував би власні стелі, був би четвертим прайслистом. Понад картки він додає одне, чого прайслист не знає, — у що саме щойно вперлись і наскільки воно повне."
        filePath="src/components/ui/Feedback/PlanUpgradeDialog.jsx"
        fullWidth
      >
        <Button style="secondary" onClick={() => setPlanDialogOpen(true)}>Показати діалог</Button>
        <PlanUpgradeDialog
          isOpen={planDialogOpen}
          onClose={() => setPlanDialogOpen(false)}
          notice={planLimitNotice('free', 'projects', 3)}
          currentPlanId="free"
          onChoose={() => setPlanDialogOpen(false)}
        />
      </PreviewBlock>

    </div>
  );
}
