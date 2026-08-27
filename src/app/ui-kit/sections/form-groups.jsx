'use client';
import { useState } from 'react';
import { Input } from '@/components/ui/Input';
import { FormGroup, Label, OptionCard } from '@/components/ui';
import { Bell, Users, MapPin, Shield, UserRound, Briefcase } from 'lucide-react';
import { PreviewBlock } from '../preview';

export default function FormGroupsSection() {
  const [role, setRole] = useState('member');

  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock title="Form Group Layouts" component="FormGroup" description="Контейнери для полів форми. Зв'язують заголовок Label (атом) та поле вводу (Input). Обов'язкове поле позначається текстом «обов'язково» праворуч у заголовку (не червоною зірочкою), помилка — червоною рамкою поля й текстом під ним." fullWidth>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-[24px] max-w-[900px]">
          <FormGroup label="Назва проєкту">
            <Input placeholder="Введіть назву..." />
          </FormGroup>

          <FormGroup label="Електронна пошта" required>
            <Input placeholder="name@company.com" />
          </FormGroup>

          <FormGroup label="Пароль" required error="Пароль має містити щонайменше 8 символів">
            <Input type="password" placeholder="••••••••" error={true} />
          </FormGroup>
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Label з іконкою"
        description="Іконка задається пропом icon, а не вкладається в children. Preflight робить svg display:block, тож іконка всередині текстового span займає власний рядок і стає над написом — саме тому вона тут іменований проп із фіксованим розміром 13. Працює і на Label, і на FormGroup."
        filePath="src/components/ui/Forms/Label.jsx"
        fullWidth
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-[24px] max-w-[900px]">
          <FormGroup label="Учасники" icon={Users}>
            <Input placeholder="Додати учасників" />
          </FormGroup>

          <FormGroup label="Нагадування" icon={Bell} required>
            <Input placeholder="За 15 хвилин" />
          </FormGroup>

          <div className="flex flex-col gap-[6px]">
            <Label icon={MapPin}>Місце</Label>
            <Input placeholder="Офіс або кімната" />
          </div>
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Картка вибору"
        component="OptionCard"
        description="Один варіант із кількох: гліф, назва, речення пояснення і галочка на обраному. Обидва діалоги ролі малювали її руками й розходились у кожному числі — 14px радіус проти 16, p-3 проти p-4, 36px гліф проти 40. Лишився більший, бо саме він на радіусній шкалі кіту."
        fullWidth
      >
        <div className="grid w-full max-w-[720px] gap-2 sm:grid-cols-2">
          <OptionCard
            selected={role === 'member'}
            icon={UserRound}
            title="Учасник"
            description="Працює із завданнями та проєктами."
            onClick={() => setRole('member')}
          />
          <OptionCard
            selected={role === 'admin'}
            icon={Shield}
            title="Адміністратор"
            description="Керує командою та налаштуваннями."
            onClick={() => setRole('admin')}
          />
          <OptionCard icon={Briefcase} title="Без опису" onClick={() => {}} />
          <OptionCard
            selected
            disabled
            icon={Shield}
            title="Власник"
            description="Роль фіксована — її не змінює навіть власник."
          />
        </div>
      </PreviewBlock>
    </div>
  );
}
