'use client';
import { useState } from 'react';
import Button from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import Surface from '@/components/ui/Surface';
import { Alert, ConnectionBanner, LoadingSpinner, EmptyState } from '@/components/ui';
import { Toast } from '@/components/ui/Feedback/Toast';
import { User, Folder, Plug } from 'lucide-react';
import { ChatIcon } from '@/lib/design/icons';
import { PreviewBlock } from '../preview';

export default function FeedbackSection() {
  const [qtPlusProject, setQtPlusProject] = useState('');
  const [toast, setToast] = useState(null);
  const [offline, setOffline] = useState(false);
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

    </div>
  );
}
