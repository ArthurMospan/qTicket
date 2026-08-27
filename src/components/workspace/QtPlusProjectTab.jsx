'use client';
import { useMemo, useState } from 'react';
import { Plug, ExternalLink, MoreVertical, Link2, Unlink } from 'lucide-react';
import { can } from '@/lib/utils/can';
import { Select } from '@/components/ui/Select';
import Button from '@/components/ui/Button';
import IconAction from '@/components/ui/IconAction';
import ContextMenu from '@/components/ui/ContextMenu';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { usePortalSession } from '@/lib/portal/usePortalSession';
import { usePortalProjects } from '@/lib/portal/usePortalProjects';
import { toPortalProjectOptions, resolveLinkView } from '@/lib/portal/qtplusLinkModel.mjs';
import { linkQtPlusProject, unlinkQtPlusProject } from '@/lib/portal/qtplusProjectLink';
import { disconnectQtPlusAccount, startQtPlusConnect } from '@/lib/portal/qtplusAccount';
import QtPlusLinkedContent from '@/components/workspace/qtplus/QtPlusLinkedContent';
import EmptyState from '@/components/ui/Feedback/EmptyState';

// Заголовок привʼязки. Раніше він сидів на власній білій картці всередині
// білої ж панелі — прямокутник, обведений навколо назви й кнопки без жодної
// причини, бо відокремлювати його не було від чого. Тепер це просто рядок:
// назва, прогрес по етапах поруч із нею, «Перейти» і меню дій.
function LinkedRow({ name, stale, menuItems, href, progress }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <h2 className="ui-type-section-title min-w-0 truncate tracking-tight text-ink">
          {name || 'Без назви'}
        </h2>
        {progress}
        <span className="flex-1" />
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-[32px] shrink-0 items-center gap-1.5 rounded-[10px] bg-canvas px-3 text-[12px] font-bold text-ink transition-colors hover:bg-line"
            title="Відкрити цей проєкт у QuickTeam+"
          >
            <ExternalLink size={13} />
            Перейти
          </a>
        )}
        {menuItems && (
          <div className="shrink-0">
            <ContextMenu
              trigger={
                <IconAction
                  label="Дії з привʼязкою"
                  icon={MoreVertical}
                  size="sm"
                  shape="circle"
                />
              }
              items={menuItems}
            />
          </div>
        )}
      </div>
      {stale && (
        <p className="text-[12px] text-muted">
          Цей проєкт QuickTeam+ зараз недоступний для вашого акаунта.
        </p>
      )}
    </div>
  );
}

export default function QtPlusProjectTab({ project, orgRole, currentUser, allProjects }) {
  const canManage = can(orgRole, 'edit:project_settings');
  const showToast = useWorkspaceStore((s) => s.showToast);

  const { portalUser, loading: sessionLoading, error: sessionError } = usePortalSession();
  const { projects: portalProjects, loading: projectsLoading } = usePortalProjects(portalUser);

  const [pendingId, setPendingId] = useState('');
  const [saving, setSaving] = useState(false);
  const [changing, setChanging] = useState(false);

  const link = project?.qtplusLink || null;
  const optionsLoaded = Boolean(portalUser) && !projectsLoading && Array.isArray(portalProjects);

  const options = useMemo(() => toPortalProjectOptions(portalProjects), [portalProjects]);
  const otherLinkedIds = useMemo(
    () => (allProjects || [])
      .filter((p) => p.id !== project?.id && p.qtplusLink?.projectId)
      .map((p) => p.qtplusLink.projectId),
    [allProjects, project?.id],
  );
  const view = useMemo(
    () => resolveLinkView({ link, options, otherLinkedIds, optionsLoaded }),
    [link, options, otherLinkedIds, optionsLoaded],
  );

  const selectValue = pendingId || view.selectedId || '';
  const selectOptions = view.options.map((o) => ({
    value: o.id,
    label: o.linkedElsewhere ? `${o.name} (вже привʼязано)` : o.name,
  }));

  const doLink = async () => {
    const chosen = options.find((o) => o.id === selectValue);
    if (!chosen) return;
    setSaving(true);
    try {
      await linkQtPlusProject(project.id, chosen, currentUser?.uid || null);
      setPendingId('');
      setChanging(false);
      showToast('Проєкт QuickTeam+ привʼязано');
    } catch (err) {
      console.error('[qtplus] link failed:', err);
      showToast('Не вдалося привʼязати проєкт', 'error');
    }
    setSaving(false);
  };

  // The account link starts and ends here rather than in a settings tab of its
  // own: connecting QuickTeam+ only ever mattered in order to link a project, so
  // the button belongs next to that. The return path brings the OAuth round-trip
  // back to this project instead of dumping the user in Settings.
  const connectAccount = () => {
    startQtPlusConnect(`${window.location.pathname}${window.location.search}`);
  };

  const disconnectAccount = async () => {
    setSaving(true);
    try {
      await disconnectQtPlusAccount();
      showToast('Акаунт QuickTeam+ відключено');
      window.location.reload();
    } catch (err) {
      console.error('[qtplus] account disconnect failed:', err);
      showToast(err.message === 'NOT_SIGNED_IN'
        ? 'Потрібно увійти повторно'
        : 'Не вдалося відключити акаунт QuickTeam+', 'error');
      setSaving(false);
    }
  };

  const doUnlink = async () => {
    setSaving(true);
    try {
      await unlinkQtPlusProject(project.id);
      setPendingId('');
      showToast('Проєкт QuickTeam+ відвʼязано');
    } catch (err) {
      console.error('[qtplus] unlink failed:', err);
      showToast('Не вдалося відвʼязати проєкт', 'error');
    }
    setSaving(false);
  };

  const portalProjectUrl = process.env.NEXT_PUBLIC_QTPLUS_URL && link?.projectId
    ? `${process.env.NEXT_PUBLIC_QTPLUS_URL}/project/${link.projectId}`
    : null;

  // ── Member (read-only). Members only reach this tab when linked; guard anyway. ──
  if (!canManage) {
    if (!view.linked) return null;
    return (
      <div className="flex min-h-[240px] flex-1 flex-col">
        {portalUser ? (
          <QtPlusLinkedContent
            qtProjectId={link.projectId}
            portalUser={portalUser}
            currentUser={currentUser}
            header={(progress) => <LinkedRow name={view.linkedName} href={portalProjectUrl} progress={progress} />}
          />
        ) : (
          <div data-ui-surface="panel" data-ui-padding="md" className="ui-surface">
            <LinkedRow name={view.linkedName} href={portalProjectUrl} />
          </div>
        )}
      </div>
    );
  }

  // ── Owner/admin ──
  return (
    <div className={`flex min-h-[240px] flex-1 flex-col gap-4 rounded-[16px] ${view.linked ? 'bg-transparent' : 'bg-canvas p-[16px]'}`}>
      {view.linked ? (
        <>
          {portalUser && !view.staleAccess && (
            <QtPlusLinkedContent
              qtProjectId={link.projectId}
              portalUser={portalUser}
              currentUser={currentUser}
              header={(progress) => (
                <div className="flex flex-col gap-3">
                  <LinkedRow
                    name={view.linkedName}
                    stale={view.staleAccess}
                    href={portalProjectUrl}
                    progress={progress}
                    menuItems={[
                      ...(portalUser && options.length > 0
                        ? [{ label: 'Змінити привʼязку', icon: Link2, onClick: () => setChanging(true) }]
                        : []),
                      { label: 'Відвʼязати', icon: Unlink, onClick: doUnlink, isDanger: true },
                      // Account-level, not project-level: the only home it has
                      // now that the personal settings tab is gone.
                      { label: 'Відключити акаунт QuickTeam+', icon: Plug, onClick: disconnectAccount, isDanger: true },
                    ]}
                  />
                  {changing && options.length > 0 && (
                    <div className="flex max-w-[640px] flex-wrap items-center gap-2">
                      <Select
                        value={selectValue}
                        onChange={setPendingId}
                        options={selectOptions}
                        placeholder="Оберіть проєкт QuickTeam+"
                        className="min-w-[260px] flex-1"
                      />
                      <Button style="secondary" size="lg" onClick={doLink} disabled={saving || !selectValue || selectValue === view.linkedId}>
                        Змінити
                      </Button>
                      <Button style="ghost" size="lg" onClick={() => { setChanging(false); setPendingId(''); }} disabled={saving}>
                        Скасувати
                      </Button>
                    </div>
                  )}
                </div>
              )}
            />
          )}
          {view.staleAccess && (
            <div data-ui-surface="panel" data-ui-padding="md" className="ui-surface">
              <LinkedRow
                name={view.linkedName}
                stale
                href={portalProjectUrl}
                menuItems={[{ label: 'Відвʼязати', icon: Unlink, onClick: doUnlink, isDanger: true }]}
              />
            </div>
          )}
          {!portalUser && !view.staleAccess && (
            <div data-ui-surface="panel" data-ui-padding="md" className="ui-surface">
              <LinkedRow
                name={view.linkedName}
                href={portalProjectUrl}
                menuItems={[{ label: 'Відвʼязати', icon: Unlink, onClick: doUnlink, isDanger: true }]}
              />
            </div>
          )}
        </>
      ) : sessionLoading || projectsLoading ? (
        <p className="text-[13px] text-muted">Перевіряємо доступ до QuickTeam+…</p>
      ) : (!portalUser || sessionError === 'not_connected') ? (
        <EmptyState
          icon={Plug}
          title="Підключіть QuickTeam+"
          description="Підключіть акаунт, щоб привʼязати проєкт і працювати з матеріалами та чатом."
          action="Підключити QuickTeam+"
          onAction={connectAccount}
          context="inset"
          surface="card"
        />
      ) : sessionError === 'grant_invalid' ? (
        <EmptyState
          icon={Plug}
          title="Підключення застаріло"
          description="Доступ до QuickTeam+ більше не дійсний. Підключіть акаунт заново."
          action="Підключити заново"
          onAction={connectAccount}
          context="inset"
          surface="card"
        />
      ) : sessionError ? (
        <p className="text-[13px] text-muted">Не вдалося зʼєднатися з QuickTeam+. Спробуйте пізніше.</p>
      ) : options.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="Немає доступних проєктів"
          description="У підключеному акаунті QuickTeam+ поки немає проєктів, які можна прив’язати."
          context="inset"
          surface="card"
        />
      ) : (
        <EmptyState
          icon={Link2}
          title="Оберіть проєкт QuickTeam+"
          description="Привʼяжіть відповідний клієнтський проєкт, щоб бачити тут етапи, матеріали та чат."
          context="flexible"
          surface="card"
          className="w-full"
        >
          <div className="mx-auto flex w-full max-w-[520px] flex-col items-stretch gap-2 sm:flex-row">
            <Select
              value={selectValue}
              onChange={setPendingId}
              options={selectOptions}
              placeholder="Оберіть проєкт QuickTeam+"
              className="min-w-0 flex-1 text-left"
            />
            <Button style="primary" size="lg" onClick={doLink} disabled={saving || !selectValue}>
              Привʼязати
            </Button>
          </div>
        </EmptyState>
      )}
    </div>
  );
}
