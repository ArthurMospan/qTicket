'use client';
import { PresenceDot, UserAvatar } from '@/components/ui';
import { PreviewBlock } from '../preview';

export default function AvatarsSection() {
  const sizes = [['xs', 16], ['sm', 24], ['md', 32], ['lg', 40], ['xl', 48], ['hero', 96]];
  const demoUser = { id: 'ui-kit-arthur', name: 'Артур Моспан' };
  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock
        title="UserAvatar sizes"
        component="UserAvatar"
        description="Канонічний живий аватар із продукту: фото, fallback-ініціали, детермінований колір і tooltip. Розмір задається токеном шкали, а не числом — джерело значень одне, у AVATAR_SIZES."
        filePath="src/components/ui/DataDisplay/UserAvatar.jsx"
      >
        <div className="flex flex-wrap items-end gap-[16px]">
          {sizes.map(([token, px]) => (
            <div key={token} className="flex flex-col items-center gap-[6px]">
              <UserAvatar user={demoUser} size={token} tooltip />
              <span className="text-[9px] font-mono text-[#1f1f1f]">{token}</span>
              <span className="text-[9px] font-mono text-[#cfcfcf]">{px}px</span>
            </div>
          ))}
        </div>
      </PreviewBlock>

      <PreviewBlock title="UserAvatar states" description="Ті самі стани, які реально бачить користувач: брендований колір і відсутні дані.">
        <UserAvatar user={{ name: 'Олена Коваль', avatarColor: '#059669' }} size="lg" tooltip />
        <UserAvatar user={null} size="lg" />
      </PreviewBlock>

      <PreviewBlock
        title="PresenceDot"
        component="PresenceDot"
        description="Позначка «зараз онлайн» на розі аватара. Розмір іде за розміром аватара, а не обирається на місці — саме так чотири копії цієї крапки й розійшлися на 8, 10, 12 і 20 пікселів."
        filePath="src/components/ui/DataDisplay/PresenceDot.jsx"
      >
        <div className="flex flex-wrap items-end gap-[16px]">
          {[['xs', 'chat-mention'], ['sm', 'sm'], ['md', 'md'], ['lg', 'lg'], ['hero', 'xl']].map(([token, avatarSize]) => (
            <div key={token} className="flex flex-col items-center gap-[6px]">
              <span className="relative inline-flex">
                <UserAvatar user={demoUser} size={avatarSize} />
                <PresenceDot size={token} collar="white" />
              </span>
              <span className="text-[9px] font-mono text-[#1f1f1f]">{token}</span>
            </div>
          ))}
        </div>
      </PreviewBlock>
    </div>
  );
}
