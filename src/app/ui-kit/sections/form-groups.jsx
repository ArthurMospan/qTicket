'use client';
import { useState } from 'react';
import { Input } from '@/components/ui/Input';
import { FormGroup, Label, OptionCard } from '@/components/ui';
import { Bell, Users, MapPin, Shield, UserRound } from 'lucide-react';
import { PreviewBlock } from '../preview';

export default function FormGroupsSection() {
  const [role, setRole] = useState('client_member');

  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock title="Form Group Layouts" component="FormGroup" description="Контейнери для полів форми. Зв'язують заголовок Label (атом) та поле вводу (Input). Обов'язкове поле позначається текстом «обов'язково» праворуч у заголовку (не червоною зірочкою), помилка — червоною рамкою поля й текстом під ним." fullWidth>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-[24px] max-w-[900px]">
          <FormGroup label="Назва клієнта">
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
        title="Option Card"
        component="OptionCard"
        description="Один вибір із набору, намальований карткою, бо варіанти різняться наслідком, а не словом: «цей зможе запрошувати інших» не вміщується в підпис радіо-кнопки. Обраний тримає чорнильну рамку, залитий гліф і галочку. Геометрія — QuickTeam-ова, до пікселя: той самий діалог запрошення існує в обох продуктах."
        filePath="src/components/ui/Forms/OptionCard.jsx"
        fullWidth
      >
        <div className="grid max-w-[640px] gap-2 sm:grid-cols-2">
          <OptionCard
            icon={UserRound}
            title="Співробітник"
            description="Створює звернення й пише в них."
            selected={role === 'client_member'}
            onClick={() => setRole('client_member')}
          />
          <OptionCard
            icon={Shield}
            title="Адміністратор"
            description="Те саме, плюс запрошує інших співробітників."
            selected={role === 'client_admin'}
            onClick={() => setRole('client_admin')}
          />
        </div>
      </PreviewBlock>

    </div>
  );
}
