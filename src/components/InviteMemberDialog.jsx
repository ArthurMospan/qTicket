'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Link2, Mail } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import Pill from '@/components/ui/DataDisplay/Pill';
import Surface from '@/components/ui/Surface';
import Tabs from '@/components/ui/Tabs';
import InviteLinkSection from '@/components/InviteLinkSection';
import Alert from '@/components/ui/Feedback/Alert';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import Label from '@/components/ui/Forms/Label';
import { useAppContext } from '@/lib/context/AppContext';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { isClientRole } from '@/lib/utils/can';
import { organizationRoleLabel } from '@/lib/utils/orgMembership.mjs';
import { organizationPortalName } from '@/lib/utils/organizationBranding.mjs';
import { GITHUB_LOGIN_ENABLED } from '@/lib/utils/loginProviders.mjs';


/**
 * The only two invitations qTicket issues, and there is no third.
 *
 * Support staff are enabled in QuickTeam and arrive through signed
 * provisioning, so this dialog never offers an internal role: it either seats a
 * client administrator in one client project (`clientAdminMode`, opened from
 * that project) or lets that administrator add one of their own employees
 * (`clientMode`). Both carry the project they were opened for, so neither asks
 * a question the screen has already answered.
 */
export default function InviteMemberDialog({
  isOpen,
  onClose,
  inviteMember,
  clientMode = false,
  clientAdminMode = false,
  projectIds = [],
  spaceName = '',
}) {
  const { activeOrg, currentUser, orgRole } = useAppContext();
  const clientInvite = clientMode || isClientRole(orgRole);
  // The instruction goes to a client, so it is signed by the tenant. «Вам
  // підготовлено доступ до qTicket» named the software the client has never
  // heard of instead of the company they are already buying support from.
  const portalName = organizationPortalName(activeOrg);
  const showToast = useWorkspaceStore(state => state.showToast);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [inviting, setInviting] = useState(false);
  const [sent, setSent] = useState(false);
  const [undelivered, setUndelivered] = useState(false);
  const [pendingAccessEmail, setPendingAccessEmail] = useState('');
  // Two ways to hand somebody the same access, and they are two halves of one
  // dialog rather than a dialog and a panel somewhere else on the page: you
  // either know the person's address or you do not, and that is a choice made
  // in the moment of inviting them.
  const [tab, setTab] = useState('email');

  const invitedRole = clientInvite ? 'client_member' : 'client_admin';
  const linkProjectId = Array.isArray(projectIds) ? projectIds[0] : '';

  useEffect(() => {
    if (!isOpen) return;
    queueMicrotask(() => {
      setTab('email');
      setEmail('');
      setEmailError('');
      setSent(false);
      setUndelivered(false);
      setPendingAccessEmail('');
    });
  }, [isOpen]);

  const copyLoginInstructions = async () => {
    const loginUrl = new URL('/login?mode=client', window.location.origin).toString();
    const instructions = `Вам підготовлено доступ до порталу підтримки «${portalName}».\n\n1. Відкрийте: ${loginUrl}\n2. Увійдіть через ${GITHUB_LOGIN_ENABLED ? 'Google або GitHub' : 'Google'}.\n3. Використайте акаунт з адресою ${pendingAccessEmail} — вона має точно збігатися з адресою запрошення.\n\nПісля першого входу доступ до проєкту підключиться автоматично.`;

    try {
      await navigator.clipboard.writeText(instructions);
      showToast('Інструкцію для входу скопійовано', 'success');
    } catch {
      showToast('Не вдалося скопіювати інструкцію — скопіюйте адресу входу вручну', 'error');
    }
  };

  const handleInvite = async event => {
    event.preventDefault();
    if (inviting) return;
    if (!email.trim()) {
      setEmailError('Вкажіть email учасника');
      return;
    }
    setEmailError('');
    setInviting(true);
    try {
      const uid = currentUser?.id || currentUser?.uid;
      const normalizedEmail = email.trim().toLowerCase();
      const result = await inviteMember(normalizedEmail, uid, invitedRole, projectIds);
      setSent(true);
      if (result.emailSent === false) {
        // The invitation exists and works — it is accepted automatically on the
        // invitee's first login with that address. An existing account may have
        // been seated directly instead; either way the person still needs the
        // login address when no letter was delivered.
        setUndelivered(true);
        setPendingAccessEmail(normalizedEmail);
        showToast(clientInvite ? 'Доступ підготовлено — передайте інструкцію співробітнику' : 'Запрошення створено — передайте інструкцію для входу', 'success');
      } else {
        // A reactivated or already registered account is still notified by the
        // same best-effort letter, so the successful delivery is accurately
        // described as an invitation rather than a second membership change.
        showToast('Запрошення надіслано', 'success');
      }
      if (result.emailSent !== false) {
        setTimeout(() => {
          setEmail('');
          setSent(false);
        }, 1800);
      }
    } catch (error) {
      showToast(error.message || 'Не вдалося надіслати запрошення', 'error');
    } finally {
      setInviting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={clientInvite ? 'Запросити співробітника' : 'Запросити клієнта'}
      size="lg"
      bodyPadding="invite"
    >
      <div className="flex flex-col gap-6">
        {/* What QuickTeam's version puts here is a role picker: two OptionCards
            deciding what the invitation grants. qTicket has no such choice —
            the role is fixed by where the dialog was opened from, and the
            server re-derives it anyway — so the dialog used to begin with a
            pair of narrow tabs against a lot of white, which is why it read as
            the poorer relation of the same screen.
            The answer is not to invent a choice. It is to state the one that
            has already been made: who is being invited, and into which project.
            Same weight, same structure, and nothing on it pretends to be a
            control. */}
        <Surface preset="inset" padding="md" className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Роль</span>
            <Pill tone="ink-subtle" size="md">{organizationRoleLabel(invitedRole)}</Pill>
          </div>
          {spaceName ? (
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Проєкт</span>
              <p className="truncate text-[13px] font-semibold text-ink">{spaceName}</p>
            </div>
          ) : null}
        </Surface>

        {/* Full width, both halves equal. Two tabs floated left in a `lg`
            dialog left the eye no reason to believe they were the whole of the
            choice. */}
        <Tabs
          tabs={[
            { id: 'email', label: 'Електронна пошта', icon: Mail },
            { id: 'link', label: 'Посилання та QR', icon: Link2 },
          ]}
          activeTab={tab}
          onTabChange={setTab}
          className="w-full [&>button]:flex-1"
        />

        {tab === 'link' ? (
          <InviteLinkSection role={invitedRole} projectId={linkProjectId} spaceName={spaceName} />
        ) : (
        <form noValidate onSubmit={handleInvite} className="flex flex-col gap-3">
          <Label required>
            {clientInvite ? 'Email співробітника' : 'Email адміністратора клієнта'}
          </Label>
          <div className="flex gap-2">
            {/* The kit's standard large control, both halves. They used to
                share an `invite-*` composition that made them 52px tall with
                a 14px radius — a whole size that existed for one row, and
                visibly the largest field and button in the product. */}
            <Input
              autoFocus
              size="lg"
              type="email"
              value={email}
              onChange={event => {
                setEmail(event.target.value);
                if (emailError) setEmailError('');
                if (sent) setSent(false);
                if (undelivered) setUndelivered(false);
                if (pendingAccessEmail) setPendingAccessEmail('');
              }}
              placeholder="name@example.com"
              error={Boolean(emailError)}
            />
            <Button
              type="submit"
              style="primary"
              size="lg"
              loading={inviting}
              disabled={sent}
              icon={sent ? Check : null}
            >
              {sent
                ? (clientInvite ? 'Доступ готовий' : (undelivered ? 'Створено' : 'Надіслано'))
                : (clientInvite ? 'Надати доступ' : 'Запросити')}
            </Button>
          </div>
          {emailError && <span className="text-[11px] text-danger">{emailError}</span>}
          {undelivered ? (
            <Alert variant="info" title={clientInvite ? 'Доступ підготовлено без листа' : 'Запрошення підготовлено без листа'}>
              <div className="flex flex-col items-start gap-3">
                <p>
                  {clientInvite
                    ? <>Передайте інструкцію співробітнику в месенджері. Під час входу він має використати {GITHUB_LOGIN_ENABLED ? 'Google або GitHub-акаунт' : 'Google-акаунт'} з адресою <strong>{pendingAccessEmail}</strong>.</>
                    : <>Передайте інструкцію адміністратору клієнта в месенджері. Він має увійти через Google-акаунт з адресою <strong>{pendingAccessEmail}</strong>.</>}
                </p>
                <Button type="button" style="secondary" size="sm" icon={Copy} onClick={copyLoginInstructions}>
                  Скопіювати інструкцію
                </Button>
              </div>
            </Alert>
          ) : (
            <p className="text-[11px] leading-5 text-muted">
              {clientInvite
                ? 'Вкажіть email Google-акаунта співробітника. Після створення скопіюйте інструкцію та надішліть її в месенджері.'
                : 'Вкажіть email адміністратора клієнта. Якщо пошта не налаштована, система одразу підготує інструкцію для месенджера.'}
            </p>
          )}
        </form>
        )}
      </div>
    </Dialog>
  );
}
