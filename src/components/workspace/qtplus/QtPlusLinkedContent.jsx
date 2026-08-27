'use client';
import QtPlusStagesView from './QtPlusStagesView';
import QtPlusChatPanel from './chat/QtPlusChatPanel';

/**
 * Вміст привʼязаної вкладки QuickTeam+: етапи/матеріали ліворуч, чат збоку праворуч.
 * На вузькому екрані (< lg) чат стає під етапами. qtProjectId — id проєкту в порталі.
 * Монтується лише коли portalUser вже автентифікований (гейт у QtPlusProjectTab).
 *
 * Панель без власного падінгу: смуга етапів має дійти до її країв, тож відступи
 * тримає `QtPlusStagesView` — окремо для шапки, окремо для матеріалів, а між
 * ними смуга йде на всю ширину блоку.
 */
export default function QtPlusLinkedContent({ qtProjectId, portalUser, currentUser, header = null }) {
  return (
    <div className="grid min-h-[520px] flex-1 grid-cols-1 items-stretch gap-4 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div data-ui-surface="panel" data-ui-padding="none" className="ui-surface flex min-h-[520px] min-w-0 flex-col overflow-hidden lg:min-h-0">
        <QtPlusStagesView qtProjectId={qtProjectId} header={header} />
      </div>
      <aside className="h-[520px] min-h-[440px] w-full overflow-hidden rounded-[16px] bg-canvas lg:h-full lg:min-h-0">
        <QtPlusChatPanel qtProjectId={qtProjectId} portalUser={portalUser} currentUser={currentUser} embedded />
      </aside>
    </div>
  );
}
