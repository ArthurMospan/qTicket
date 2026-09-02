'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Link2, Mail, Shield, UserRound } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import Pill from '@/components/ui/DataDisplay/Pill';
import Surface from '@/components/ui/Surface';
import Tabs from '@/components/ui/Tabs';
import OptionCard from '@/components/ui/Forms/OptionCard';
import FormGroup from '@/components/ui/Forms/FormGroup';
import { Select } from '@/components/ui/Select';
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

// The two client seats, and only one of them is this dialog's to give.
//
// «Адміністратор» is drawn and disabled rather than left out, because leaving
// it out would answer a question a customer does have — «can I make my
// colleague an administrator?» — with silence, and the second card is the
// shortest place to say what the seat is and who decides it.
//
// Why it is not on offer: granting a role is half a feature, and the other half
// is taking it back. qTicket has no screen that demotes a client administrator,
// on purpose — the desk does not administer a customer's people, and a
// customer's roster is not a place to put a role editor. So this seat stays
// with the one flow that is already reversible by the people who own it: the
// desk seats a client administrator from the project's «Учасники» tab. Three
// places agree — this card, `invitedRoleFor`, and `inviteLinkRole`.
const CLIENT_ROLE_OPTIONS = [
  {
    value: 'client_member',
    label: 'Співробітник',
    description: 'Створює звернення й пише в них.',
    icon: UserRound,
  },
  {
    value: 'client_admin',
    label: 'Адміністратор',
    description: 'Визначається лише працівниками з підтримки. Може запрошувати в проєкт співробітників.',
    icon: Shield,
    disabled: true,
  },
];

/**
 * The only two invitations qTicket issues, and there is no third.
 *
 * Support staff are enabled in QuickTeam and arrive through signed
 * provisioning, so this dialog never offers an internal role: it either seats a
 * client administrator in one client project (`clientAdminMode`, opened from
 * that project) or lets that administrator add one of their own people
 * (`clientMode`).
 *
 * The one question it asks is the one the screen behind it cannot answer: which
 * of that administrator's projects the invitation is for, when they hold more
 * than one. The answer is re-derived on the server — `resolveInvitationScope`
 * refuses a project the author is not on, `invitedRoleFor` refuses every role
 * but `client_member` — so what is chosen here is a convenience, never the
 * authorization.
 *
 * @param {object[]} props.projects The client spaces this invitation may name. One means no question; several put a picker on the dialog.
 * @param {string[]} props.projectIds Legacy single-project form, kept for the support-side «Запросити клієнта».
 */
export default function InviteMemberDialog({
  isOpen,
  onClose,
  inviteMember,
  clientMode = false,
  clientAdminMode = false,
  projects = [],
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

  // Which client spaces this invitation may name.
  //
  // The «+» beside «Співробітники» used to disappear the moment an
  // administrator was on a second project, because the rail had nowhere to ask
  // «в який?» — so the one screen that administers a customer's people stopped
  // offering to add any. The question belongs in the dialog, where every other
  // question about the invitation already is.
  const spaces = useMemo(() => {
    const listed = (Array.isArray(projects) ? projects : []).filter(project => project?.id);
    if (listed.length) return listed;
    return (Array.isArray(projectIds) ? projectIds : [])
      .filter(Boolean)
      .map(id => ({ id, name: spaceName }));
  }, [projects, projectIds, spaceName]);

  const [projectId, setProjectId] = useState('');
  const [role, setRole] = useState('client_member');
  // The support-side invitation seats a client administrator and asks nothing:
  // it is opened from one project, for the one role that project needs first.
  // The client-side one asks, and today there is one answer to pick — the
  // server re-derives it either way, so this is what is shown, never what is
  // enforced.
  const invitedRole = clientInvite ? role : 'client_admin';
  const selectedSpace = spaces.find(space => space.id === projectId) || null;
  const selectedSpaceName = selectedSpace?.name || spaceName;

  useEffect(() => {
    if (!isOpen) return;
    queueMicrotask(() => {
      setTab('email');
      setEmail('');
      setEmailError('');
      setSent(false);
      setUndelivered(false);
      setPendingAccessEmail('');
      setRole('client_member');
      setProjectId(spaces.length === 1 ? spaces[0].id : '');
    });
    // The spaces are read at the moment the dialog opens; re-running this on
    // every re-render of the list behind it would reset a half-typed address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const copyLoginInstructions = async () => {
    const loginUrl = new URL('/login?mode=client', window.location.origin).toString();
    const instructions = `Вам підготовлено доступ до порталу підтримки «${portalName}».\n\n1. Відкрийте: ${loginUrl}\n2. Увійдіть з адресою ${pendingAccessEmail} — вона має точно збігатися з адресою запрошення.\n\nПісля першого входу доступ до проєкту підключиться автоматично.`;

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
    if (!projectId) {
      showToast('Оберіть проєкт, у який запрошуєте', 'error');
      return;
    }
    if (!email.trim()) {
      setEmailError('Вкажіть email учасника');
      return;
    }
    setEmailError('');
    setInviting(true);
    try {
      const uid = currentUser?.id || currentUser?.uid;
      const normalizedEmail = email.trim().toLowerCase();
      const result = await inviteMember(normalizedEmail, uid, invitedRole, [projectId]);
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
        {/* What QuickTeam puts at the top of this dialog is a role picker, and
            this one wears the same two cards, the same geometry: one dialog in
            two products cannot be two dialogs. What differs is that here the
            second card is disabled — see `CLIENT_ROLE_OPTIONS` for why a seat
            nothing in the product can take back is not a seat this dialog
            gives. A picker of one is still worth drawing when the option it
            greys out is the question people arrive with.

            The support-side invitation has no choice to offer at all: it seats
            the client's first administrator, from the project it was opened
            for, and the server re-derives that anyway. It states the decision
            instead of inventing a control for it. */}
        {clientInvite ? (
          <section>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-muted">Роль у проєкті</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {CLIENT_ROLE_OPTIONS.map(option => (
                <OptionCard
                  key={option.value}
                  selected={!option.disabled && role === option.value}
                  disabled={option.disabled}
                  icon={option.icon}
                  title={option.label}
                  description={option.description}
                  onClick={option.disabled ? undefined : () => setRole(option.value)}
                />
              ))}
            </div>
          </section>
        ) : null}

        {spaces.length > 1 ? (
          <FormGroup label="Проєкт" required>
            <Select
              size="lg"
              value={projectId}
              onChange={setProjectId}
              placeholder="Оберіть проєкт"
              ariaLabel="Проєкт, у який запрошуємо"
              options={spaces.map(space => ({ value: space.id, label: space.name || space.id }))}
            />
          </FormGroup>
        ) : (
          <Surface preset="inset" padding="md" className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {!clientInvite && (
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Роль</span>
                <Pill tone="ink-subtle" size="md">{organizationRoleLabel(invitedRole)}</Pill>
              </div>
            )}
            {selectedSpaceName ? (
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Проєкт</span>
                <p className="truncate text-[13px] font-semibold text-ink">{selectedSpaceName}</p>
              </div>
            ) : null}
          </Surface>
        )}

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
          projectId ? (
            <InviteLinkSection role={invitedRole} projectId={projectId} spaceName={selectedSpaceName} />
          ) : (
            // A link is minted the moment this tab opens, and it is minted *for*
            // a project. With none chosen there is nothing to mint, and a link
            // to the wrong space is worse than a sentence asking which one.
            <Alert variant="info" title="Спочатку оберіть проєкт">
              Посилання відкриває доступ до одного проєкту, тож його неможливо створити, поки не обрано, до якого саме.
            </Alert>
          )
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
                    ? <>Передайте інструкцію співробітнику в месенджері. Під час входу він має використати адресу <strong>{pendingAccessEmail}</strong>.</>
                    : <>Передайте інструкцію адміністратору клієнта в месенджері. Він має увійти з адресою <strong>{pendingAccessEmail}</strong>.</>}
                </p>
                <Button type="button" style="secondary" size="sm" icon={Copy} onClick={copyLoginInstructions}>
                  Скопіювати інструкцію
                </Button>
              </div>
            </Alert>
          ) : (
            // The line under the field used to name Google, and one provider on
            // one screen is a promise the login page does not make: it already
            // offers more than one door, and email sign-in is on its way. What
            // the reader actually needs to know is that the invitation is a
            // letter and that it lands in this project — the address matters
            // because the seat is bound to it, not because of whose account it
            // happens to be.
            <p className="text-[11px] leading-5 text-muted">
              {clientInvite
                ? 'Людина отримає лист із безпечним входом до вашого проєкту.'
                : 'Людина отримає лист із безпечним входом до цього проєкту. Якщо пошта не налаштована, система одразу підготує інструкцію для месенджера.'}
            </p>
          )}
        </form>
        )}
      </div>
    </Dialog>
  );
}
