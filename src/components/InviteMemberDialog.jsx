'use client';

import { useEffect, useState } from 'react';
import { Building2, Check, Copy, Mail, Shield, UserRound } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import Alert from '@/components/ui/Feedback/Alert';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import Label from '@/components/ui/Forms/Label';
import OptionCard from '@/components/ui/Forms/OptionCard';
import { Select } from '@/components/ui/Select';
import Tabs from '@/components/ui/Tabs';
import InviteLinkSection from '@/components/InviteLinkSection';
import { useAppContext } from '@/lib/context/AppContext';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { isClientRole } from '@/lib/utils/can';

const ROLE_OPTIONS = [
  {
    value: 'member',
    label: 'Менеджер підтримки',
    description: 'Працює з інцидентами та проєктами, спілкується з командою.',
    icon: UserRound,
  },
  {
    value: 'admin',
    label: 'Адміністратор',
    description: 'Керує командою, процесами та налаштуваннями організації.',
    icon: Shield,
  },
  {
    value: 'client_admin',
    label: 'Адміністратор клієнта',
    description: 'Бачить один клієнтський проєкт, створює інциденти та додає своїх співробітників.',
    icon: Building2,
  },
];

const GITHUB_LOGIN_ENABLED = process.env.NEXT_PUBLIC_GITHUB_LOGIN_ENABLED === 'true';

export default function InviteMemberDialog({
  isOpen,
  onClose,
  inviteMember,
  clientMode = false,
  clientAdminMode = false,
  projectIds = [],
  projects = [],
}) {
  const { currentUser, orgRole } = useAppContext();
  const clientInvite = clientMode || isClientRole(orgRole);
  const showToast = useWorkspaceStore(state => state.showToast);
  const [tab, setTab] = useState('email');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [role, setRole] = useState('member');
  const [inviting, setInviting] = useState(false);
  const [sent, setSent] = useState(false);
  const [undelivered, setUndelivered] = useState(false);
  const [pendingAccessEmail, setPendingAccessEmail] = useState('');
  const [pendingAccessClient, setPendingAccessClient] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [projectError, setProjectError] = useState('');

  const availableProjects = projects.filter(project => project.status !== 'archived');
  const presetProjectId = projectIds[0] || '';
  // The client-project page already names both the role and the project. Its
  // invite action opens this focused mode so an administrator does not have to
  // answer the same two questions again in a generic team dialog.
  const internalClientInvite = !clientInvite && (clientAdminMode || role === 'client_admin');

  useEffect(() => {
    if (!isOpen) return;
    queueMicrotask(() => {
      setTab('email');
      setEmail('');
      setEmailError('');
      setRole(clientInvite ? 'client_member' : (clientAdminMode ? 'client_admin' : 'member'));
      setSent(false);
      setUndelivered(false);
      setPendingAccessEmail('');
      setPendingAccessClient(false);
      setSelectedProjectId(clientAdminMode ? presetProjectId : '');
      setProjectError('');
    });
  }, [clientAdminMode, clientInvite, isOpen, presetProjectId]);

  const copyLoginInstructions = async () => {
    const loginPath = pendingAccessClient ? '/login?mode=client' : '/login';
    const loginUrl = new URL(loginPath, window.location.origin).toString();
    const instructions = pendingAccessClient
      ? `Вам підготовлено доступ до qTicket.\n\n1. Відкрийте: ${loginUrl}\n2. Увійдіть через ${GITHUB_LOGIN_ENABLED ? 'Google або GitHub' : 'Google'}.\n3. Використайте акаунт з адресою ${pendingAccessEmail} — вона має точно збігатися з адресою запрошення.\n\nПісля першого входу доступ до клієнтського проєкту підключиться автоматично.`
      : `Вам підготовлено доступ до qTicket.\n\nВідкрийте ${loginUrl} та увійдіть через акаунт з адресою ${pendingAccessEmail}. Після першого входу запрошення буде прийняте автоматично.`;

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
    if (internalClientInvite && !selectedProjectId) {
      setProjectError('Оберіть клієнтський проєкт');
      return;
    }
    setEmailError('');
    setInviting(true);
    try {
      const uid = currentUser?.id || currentUser?.uid;
      const normalizedEmail = email.trim().toLowerCase();
      const invitedProjectIds = clientInvite
        ? projectIds
        : (internalClientInvite ? [selectedProjectId] : []);
      const result = await inviteMember(
        normalizedEmail,
        uid,
        clientInvite ? 'client_member' : role,
        invitedProjectIds,
      );
      setSent(true);
      if (result.emailSent === false) {
        // The invitation exists and works — it is accepted automatically on the
        // invitee's first login with that address. An existing account may have
        // been seated directly instead; either way the person still needs the
        // login address when no letter was delivered.
        setUndelivered(true);
        setPendingAccessEmail(normalizedEmail);
        setPendingAccessClient(clientInvite || internalClientInvite);
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
      title={clientInvite
        ? 'Запросити співробітника'
        : clientAdminMode
          ? 'Запросити клієнта'
          : 'Додати менеджера підтримки'}
      size="lg"
      bodyPadding="invite"
    >
      <div className="flex flex-col gap-6">
        {!clientInvite && !clientAdminMode && <section>
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-muted">Роль у команді</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {ROLE_OPTIONS.map(option => (
              <OptionCard
                key={option.value}
                selected={role === option.value}
                icon={option.icon}
                title={option.label}
                description={option.description}
                onClick={() => {
                  setRole(option.value);
                  if (option.value === 'client_admin') setTab('email');
                  setProjectError('');
                }}
              />
            ))}
          </div>
          {internalClientInvite && (
            <div className="mt-4 flex flex-col gap-2">
              <Label required>Клієнтський проєкт</Label>
              <Select
                value={selectedProjectId}
                onChange={value => {
                  setSelectedProjectId(value);
                  setProjectError('');
                }}
                options={availableProjects.map(project => ({ value: project.id, label: project.name }))}
                placeholder={availableProjects.length ? 'Оберіть проєкт' : 'Спочатку створіть проєкт'}
                searchable={availableProjects.length > 8}
                disabled={!availableProjects.length}
                ariaLabel="Клієнтський проєкт"
                className="w-full"
              />
              {projectError && <span className="text-[11px] text-danger">{projectError}</span>}
              <p className="text-[11px] leading-5 text-muted">
                Клієнт отримає доступ лише до цього проєкту. Після входу він зможе додавати до нього своїх співробітників.
              </p>
            </div>
          )}
        </section>}

        {!clientInvite && !internalClientInvite && !clientAdminMode && <Tabs
          tabs={[
            { id: 'email', label: 'Електронна пошта', icon: Mail },
            { id: 'link', label: 'Посилання та QR' },
          ]}
          activeTab={tab}
          onTabChange={setTab}
          className="w-full [&>button]:flex-1"
        />}

        {(clientInvite || internalClientInvite || tab === 'email') ? (
          <form noValidate onSubmit={handleInvite} className="flex flex-col gap-3">
            <Label required>
              {clientInvite
                ? 'Email співробітника'
                : clientAdminMode
                  ? 'Email адміністратора клієнта'
                  : 'Email менеджера'}
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
                  if (pendingAccessClient) setPendingAccessClient(false);
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
                      : pendingAccessClient
                        ? <>Передайте інструкцію адміністратору клієнта в месенджері. Він має увійти через Google-акаунт з адресою <strong>{pendingAccessEmail}</strong>.</>
                      : <>Передайте інструкцію учаснику вручну. Запрошення прийметься автоматично після входу з адресою <strong>{pendingAccessEmail}</strong>.</>}
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
                  : 'Створіть доступ. Якщо пошта не налаштована, система одразу підготує інструкцію для месенджера.'}
              </p>
            )}
          </form>
        ) : (
          <InviteLinkSection role={role} />
        )}
      </div>
    </Dialog>
  );
}
