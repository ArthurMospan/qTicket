import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  failedInvitesMessage,
  malformedEmailsMessage,
  parseInviteEmails,
  undeliveredEmailsMessage,
} from '../src/lib/utils/inviteEmails.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('a pasted list is split, lower-cased and de-duplicated', () => {
  const { emails, malformed } = parseInviteEmails(
    ' Ivan@Company.com \n olena@company.com,ivan@company.com\n\n',
  );
  assert.deepEqual(emails, ['ivan@company.com', 'olena@company.com']);
  assert.deepEqual(malformed, []);
});

test('what is not an address is separated rather than sent', () => {
  const { emails, malformed } = parseInviteEmails('ok@company.com\nОлена\nno-at-sign');
  assert.deepEqual(emails, ['ok@company.com']);
  assert.deepEqual(malformed, ['олена', 'no-at-sign']);
  assert.match(malformedEmailsMessage(malformed), /Не схоже на email/);
  assert.equal(malformedEmailsMessage([]), '');
});

test('an undelivered letter is reported as such, with somewhere else to turn', () => {
  const message = undeliveredEmailsMessage(['ivan@company.com']);
  assert.match(message, /лист не пішов/);
  assert.match(message, /посилання/);
  assert.equal(undeliveredEmailsMessage([]), '');
});

test('a refused invitation names the address it belongs to', () => {
  const message = failedInvitesMessage([{ email: 'ivan@company.com', message: 'вже учасник' }]);
  assert.match(message, /ivan@company\.com — вже учасник/);
  assert.equal(failedInvitesMessage([]), '');
});

test('one bad address does not abandon the rest of the list', async () => {
  const { sendProjectInvitations } = await import('../src/lib/services/projectInvitations.js');
  const seen = [];
  const inviteMember = async (email, invitedBy, role, projectIds) => {
    seen.push({ email, role, projectIds });
    if (email === 'bad@company.com') throw new Error('вже учасник');
    return { type: 'invitation_sent', emailSent: email !== 'quiet@company.com' };
  };

  const result = await sendProjectInvitations(inviteMember, {
    emails: ['ok@company.com', 'bad@company.com', 'quiet@company.com'],
    projectId: 'project-1',
  });

  assert.deepEqual(result.invited, ['ok@company.com', 'quiet@company.com']);
  assert.deepEqual(result.undelivered, ['quiet@company.com']);
  assert.deepEqual(result.failures, [{ email: 'bad@company.com', message: 'вже учасник' }]);
  // Every invitation carries the project, which is what joins the invitee to it
  // in the same step as the organization.
  assert.ok(seen.every(call => call.role === 'member' && call.projectIds[0] === 'project-1'));
});

test('creating and editing a project offer the same invite affordance', async () => {
  const dashboard = await read('../src/app/(app)/page.js');
  const settings = await read('../src/components/workspace/BoardConfigModal.jsx');
  const form = await read('../src/components/ui/TaskManagement/ProjectSettingsForm.jsx');

  // Both dialogs collect the list inline and send it through the one service.
  for (const source of [dashboard, settings]) {
    assert.match(source, /parseInviteEmails\(inviteEmails\)/);
    assert.match(source, /sendProjectInvitations\(inviteMember, \{/);
    assert.match(source, /onInviteEmailsChange=\{[^}]*canInvite/);
  }
  // And the shared form no longer has a second way to invite that only one of
  // them rendered.
  assert.doesNotMatch(form, /onInvite\b/);
  assert.doesNotMatch(settings, /InviteMemberDialog/);
});
