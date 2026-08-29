import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { arrayUnion, doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, collection, increment, query, runTransaction, where, getDocs, getCountFromServer, serverTimestamp, Timestamp, writeBatch } from 'firebase/firestore';

let environment;

before(async () => {
  // Addressed rather than discovered. Left to itself the library asks the
  // emulator hub and falls back to `localhost:8080`, and on a Linux CI runner
  // `localhost` resolves to ::1 before 127.0.0.1 while the emulator binds IPv4
  // only — a refused connection that arrives looking like a rules failure.
  // `emulators:exec` exports FIRESTORE_EMULATOR_HOST, so this reads what the
  // emulator actually bound and only guesses when nothing said.
  const [emulatorHost, emulatorPort] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
  environment = await initializeTestEnvironment({
    projectId: 'quickteam-rules-test',
    firestore: {
      host: emulatorHost || '127.0.0.1',
      port: Number(emulatorPort) || 8080,
      rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'organizations', 'org-a'), {
      ownerId: 'owner-a',
      name: 'Org A',
      quickTeam: { sourceOrganizationId: 'quickteam-org-a', entitlement: 'active' },
    });
    await setDoc(doc(db, 'users', 'owner-a'), { name: 'Owner', email: 'owner@example.com' });
    await setDoc(doc(db, 'users', 'member-a'), { name: 'Member', email: 'member@example.com' });
    await setDoc(doc(db, 'users', 'member-offteam'), { name: 'Off-team member', email: 'offteam@example.com' });
    await setDoc(doc(db, 'users', 'client-admin-a'), { name: 'Client admin', email: 'client-admin@example.com' });
    await setDoc(doc(db, 'users', 'client-member-a'), { name: 'Client member', email: 'client-member@example.com' });
    await setDoc(doc(db, 'users', 'client-other'), { name: 'Other client', email: 'client-other@example.com' });
    await setDoc(doc(db, 'orgMemberships', 'org-a_owner-a'), {
      id: 'org-a_owner-a', orgId: 'org-a', userId: 'owner-a', role: 'owner',
    });
    await setDoc(doc(db, 'orgMemberships', 'org-a_admin-a'), {
      id: 'org-a_admin-a', orgId: 'org-a', userId: 'admin-a', role: 'admin',
    });
    await setDoc(doc(db, 'orgMemberships', 'org-a_member-a'), {
      id: 'org-a_member-a', orgId: 'org-a', userId: 'member-a', role: 'member',
    });
    await setDoc(doc(db, 'orgMemberships', 'org-a_member-offteam'), {
      id: 'org-a_member-offteam', orgId: 'org-a', userId: 'member-offteam', role: 'member',
    });
    await setDoc(doc(db, 'orgMemberships', 'org-a_client-admin-a'), {
      id: 'org-a_client-admin-a', orgId: 'org-a', userId: 'client-admin-a', role: 'client_admin',
    });
    await setDoc(doc(db, 'orgMemberships', 'org-a_client-member-a'), {
      id: 'org-a_client-member-a', orgId: 'org-a', userId: 'client-member-a', role: 'client_member',
    });
    await setDoc(doc(db, 'orgMemberships', 'org-a_client-other'), {
      id: 'org-a_client-other', orgId: 'org-a', userId: 'client-other', role: 'client_member',
    });
    await setDoc(doc(db, 'projects', 'project-a'), {
      organizationId: 'org-a',
      name: 'Project A',
      issueCounter: 1,
      status: 'active',
      team: ['owner-a', 'admin-a', 'member-a', 'client-admin-a', 'client-member-a'],
    });
    await setDoc(doc(db, 'issues', 'issue-a'), {
      organizationId: 'org-a', projectId: 'project-a', title: 'Issue A',
      spentMinutes: 30,
      spentMinutesMirrorVersion: 1,
      timeLogMutationVersion: 1,
    });
    await setDoc(doc(db, 'issues', 'issue-a', 'comments', 'member-comment'), {
      authorId: 'member-a', text: 'Member comment',
    });
    await setDoc(doc(db, 'issues', 'issue-a', 'comments', 'owner-comment'), {
      authorId: 'owner-a', text: 'Owner comment',
    });
    await setDoc(doc(db, 'timeLogs', 'log-owner'), {
      organizationId: 'org-a', projectId: 'project-a', issueId: 'issue-a',
      userId: 'owner-a', spentMinutes: 30,
    });
    await setDoc(doc(db, 'calendarEvents', 'staff-meeting'), {
      organizationId: 'org-a',
      organizerId: 'member-a',
      participantIds: ['owner-a', 'member-a'],
      title: 'Internal support review',
      visibility: 'team',
    });
    // The two shapes an invitation comes in: an address somebody typed, and a
    // link whose token is the whole credential.
    await setDoc(doc(db, 'invitations', 'pending-email'), {
      organizationId: 'org-a',
      email: 'invited@example.com',
      role: 'client_admin',
      scope: 'client-project',
      projectIds: ['project-a'],
      status: 'pending',
    });
    await setDoc(doc(db, 'invitations', 'pending-link'), {
      type: 'link',
      tokenHash: 'a'.repeat(64),
      organizationId: 'org-a',
      projectId: 'project-a',
      projectIds: ['project-a'],
      scope: 'client-project',
      role: 'client_member',
      status: 'pending',
      invitedBy: 'client-admin-a',
      maxUses: 10,
      usedCount: 0,
    });
  });
});

after(async () => {
  await environment?.cleanup();
});

test('a browser cannot create an organization or seat itself in one', async () => {
  // The signed QuickTeam provisioning route is the only tenant bootstrap.
  const db = environment.authenticatedContext('owner-b').firestore();
  await assertFails(setDoc(doc(db, 'organizations', 'org-b'), {
    id: 'org-b', ownerId: 'owner-b', name: 'Org B',
  }));
  await assertFails(setDoc(doc(db, 'orgMemberships', 'org-a_owner-b'), {
    id: 'org-a_owner-b', orgId: 'org-a', userId: 'owner-b', role: 'owner',
  }));
});

test('the QuickTeam organization snapshot is server-written', async () => {
  const ownerDb = environment.authenticatedContext('owner-a').firestore();
  await assertFails(updateDoc(doc(ownerDb, 'organizations', 'org-a'), {
    name: 'Forged organization',
  }));
  await assertFails(updateDoc(doc(ownerDb, 'organizations', 'org-a'), {
    logo: 'https://example.com/forged.png',
  }));
  await assertFails(updateDoc(doc(ownerDb, 'organizations', 'org-a'), {
    quickTeam: { sourceOrganizationId: 'quickteam-org-a', entitlement: 'inactive' },
  }));
  await assertFails(updateDoc(doc(ownerDb, 'organizations', 'org-a'), {
    portalBranding: { source: 'quickteam', name: 'Forged' },
  }));
});

test('a legacy standalone organization grants no qTicket access', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'organizations', 'org-a'), {
      ownerId: 'owner-a', name: 'Legacy workspace',
    });
  });
  const ownerDb = environment.authenticatedContext('owner-a').firestore();
  const clientDb = environment.authenticatedContext('client-admin-a').firestore();
  await assertFails(getDoc(doc(ownerDb, 'organizations', 'org-a')));
  await assertFails(getDoc(doc(clientDb, 'issues', 'issue-a')));
});

test('an authenticated outsider cannot self-join an organization', async () => {
  const db = environment.authenticatedContext('outsider').firestore();
  await assertFails(setDoc(doc(db, 'orgMemberships', 'org-a_outsider'), {
    id: 'org-a_outsider', orgId: 'org-a', userId: 'outsider', role: 'member',
  }));
});

test('a regular member can read only their own membership while admins can list the directory', async () => {
  const memberDb = environment.authenticatedContext('member-a').firestore();
  const adminDb = environment.authenticatedContext('admin-a').firestore();
  const ownerDb = environment.authenticatedContext('owner-a').firestore();
  const memberships = db => query(
    collection(db, 'orgMemberships'),
    where('orgId', '==', 'org-a'),
  );

  await assertSucceeds(getDoc(doc(memberDb, 'orgMemberships', 'org-a_member-a')));
  await assertFails(getDoc(doc(memberDb, 'orgMemberships', 'org-a_owner-a')));
  await assertFails(getDocs(memberships(memberDb)));
  await assertSucceeds(getDocs(memberships(adminDb)));
  await assertSucceeds(getDocs(memberships(ownerDb)));
});

test('member and workflow rates are unreadable from browser Firestore clients', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'organizations', 'org-a', 'memberRates', 'member-a'), {
      userId: 'member-a', hourlyRate: 75,
    });
    await setDoc(doc(db, 'organizations', 'org-a', 'private', 'workflowRates'), {
      positionRates: { dev: 100 },
    });
  });
  for (const uid of ['member-a', 'admin-a', 'owner-a']) {
    const db = environment.authenticatedContext(uid).firestore();
    await assertFails(getDoc(doc(db, 'organizations', 'org-a', 'memberRates', 'member-a')));
    await assertFails(getDoc(doc(db, 'organizations', 'org-a', 'private', 'workflowRates')));
  }
});

test('issue read cursors are private, identity-bound and timestamp-only', async () => {
  const memberDb = environment.authenticatedContext('member-a').firestore();
  const ownerDb = environment.authenticatedContext('owner-a').firestore();
  const cursorRef = doc(memberDb, 'organizations', 'org-a', 'issueReadState', 'member-a_issue-a');

  await assertSucceeds(setDoc(cursorRef, {
    userId: 'member-a',
    issueId: 'issue-a',
    lastSeenAt: new Date(100),
  }));
  await assertSucceeds(updateDoc(cursorRef, { lastSeenAt: new Date(200) }));
  await assertSucceeds(getDoc(cursorRef));
  await assertFails(getDoc(doc(ownerDb, 'organizations', 'org-a', 'issueReadState', 'member-a_issue-a')));
  await assertFails(setDoc(doc(memberDb, 'organizations', 'org-a', 'issueReadState', 'forged'), {
    userId: 'member-a', issueId: 'issue-a', lastSeenAt: new Date(100),
  }));
  await assertFails(setDoc(doc(memberDb, 'organizations', 'org-a', 'issueReadState', 'member-a_issue-b'), {
    userId: 'owner-a', issueId: 'issue-b', lastSeenAt: new Date(100),
  }));
  await assertFails(updateDoc(cursorRef, { issueId: 'issue-b' }));
  await assertFails(updateDoc(cursorRef, { debug: true }));
});

test('issue read cursors can only be listed through the current user scope', async () => {
  const memberDb = environment.authenticatedContext('member-a').firestore();
  const cursorCollection = collection(memberDb, 'organizations', 'org-a', 'issueReadState');
  await assertSucceeds(getDocs(query(cursorCollection, where('userId', '==', 'member-a'))));
  await assertFails(getDocs(cursorCollection));
});

test('an admin cannot bypass the invitation API by writing memberships directly', async () => {
  const db = environment.authenticatedContext('admin-a').firestore();
  const membership = { id: 'org-a_new-user', orgId: 'org-a', userId: 'new-user', role: 'member' };
  await assertFails(setDoc(doc(db, 'orgMemberships', 'org-a_new-user'), membership));
  await assertFails(setDoc(doc(db, 'orgMemberships', 'forged-id'), { ...membership, id: 'forged-id' }));
});

// ── Invite links ────────────────────────────────────────────────────────
//
// The mechanism 1717ab1 deleted came back for clients only, and these are the
// assertions that keep it there. A browser must not be able to read the hash
// that makes a link work, and must not be able to write the role it grants.

test('no browser role can read an invite link, hash included', async () => {
  for (const uid of ['owner-a', 'admin-a', 'member-a', 'client-admin-a', 'client-member-a']) {
    const db = environment.authenticatedContext(uid).firestore();
    await assertFails(getDoc(doc(db, 'invitations', 'pending-link')));
  }
  // Nor by querying around the refusal. A per-document `read` condition does
  // not protect a list: asked for the collection, the engine handed an admin
  // the very document whose `get` it had just refused, which is how a
  // `tokenHash` would be harvested in bulk. Listing invitations is therefore
  // refused outright, for every filter.
  const adminDb = environment.authenticatedContext('admin-a').firestore();
  const invitations = collection(adminDb, 'invitations');
  await assertFails(getDocs(invitations));
  await assertFails(getDocs(query(invitations, where('organizationId', '==', 'org-a'))));
  await assertFails(getDocs(query(invitations, where('tokenHash', '==', 'a'.repeat(64)))));
  await assertFails(getDocs(query(invitations, where('type', '==', 'link'))));
  await assertFails(getDocs(query(invitations, where('email', '==', 'invited@example.com'))));

  // One invitation addressed to a person is still readable by an admin, which
  // is what makes the refusals above about links rather than about the
  // collection having been closed by accident.
  await assertSucceeds(getDoc(doc(adminDb, 'invitations', 'pending-email')));
});

test('an admin cannot forge an internal seat onto an invite link', async () => {
  const adminDb = environment.authenticatedContext('admin-a').firestore();
  const ownerDb = environment.authenticatedContext('owner-a').firestore();
  const link = doc(adminDb, 'invitations', 'pending-link');
  // The whole point: `client_member` must not become `admin` between minting
  // the link and somebody opening it.
  await assertFails(updateDoc(link, { role: 'admin' }));
  await assertFails(updateDoc(link, { role: 'member' }));
  await assertFails(updateDoc(link, { maxUses: 5000 }));
  await assertFails(updateDoc(link, { projectId: 'project-b' }));
  await assertFails(updateDoc(doc(ownerDb, 'invitations', 'pending-link'), { role: 'owner' }));
  // Revoking and deleting go through the server route too, so the document is
  // untouchable rather than merely unpromotable.
  await assertFails(updateDoc(link, { status: 'revoked' }));
  await assertFails(deleteDoc(link));
});

test('an ordinary invitation cannot be turned into a link', async () => {
  const adminDb = environment.authenticatedContext('admin-a').firestore();
  await assertFails(updateDoc(doc(adminDb, 'invitations', 'pending-email'), {
    type: 'link',
    tokenHash: 'b'.repeat(64),
    role: 'admin',
  }));
  // The email invitation itself stays administrable, which is what makes the
  // refusal above about links rather than about invitations.
  await assertSucceeds(updateDoc(doc(adminDb, 'invitations', 'pending-email'), {
    status: 'cancelled',
  }));
});

test('a browser still cannot create an invitation of either shape', async () => {
  const adminDb = environment.authenticatedContext('admin-a').firestore();
  await assertFails(setDoc(doc(adminDb, 'invitations', 'forged-email'), {
    organizationId: 'org-a', email: 'someone@example.com', role: 'admin', status: 'pending',
  }));
  await assertFails(setDoc(doc(adminDb, 'invitations', 'forged-link'), {
    type: 'link', tokenHash: 'c'.repeat(64), organizationId: 'org-a',
    projectId: 'project-a', role: 'admin', status: 'pending', maxUses: 50, usedCount: 0,
  }));
});

test('a member cannot change identity fields on a membership', async () => {
  const ownerDb = environment.authenticatedContext('owner-a').firestore();
  await assertFails(updateDoc(doc(ownerDb, 'orgMemberships', 'org-a_member-a'), {
    userId: 'outsider',
  }));
});

test('the removed client role cannot be assigned to a membership', async () => {
  const ownerDb = environment.authenticatedContext('owner-a').firestore();
  await assertFails(updateDoc(doc(ownerDb, 'orgMemberships', 'org-a_member-a'), {
    role: 'client',
  }));
});

test('owner membership and organization ownership cannot be removed through client writes', async () => {
  const adminDb = environment.authenticatedContext('admin-a').firestore();
  const ownerDb = environment.authenticatedContext('owner-a').firestore();
  await assertFails(updateDoc(doc(adminDb, 'orgMemberships', 'org-a_owner-a'), { role: 'member' }));
  await assertFails(deleteDoc(doc(adminDb, 'orgMemberships', 'org-a_owner-a')));
  await assertFails(updateDoc(doc(ownerDb, 'orgMemberships', 'org-a_owner-a'), { role: 'member' }));
  await assertFails(updateDoc(doc(ownerDb, 'orgMemberships', 'org-a_member-a'), { role: 'owner' }));
  await assertFails(deleteDoc(doc(ownerDb, 'organizations', 'org-a')));
  await assertFails(updateDoc(doc(ownerDb, 'organizations', 'org-a'), { ownerId: 'member-a' }));
});

test('issue deletion cannot bypass the hierarchy-aware server route', async () => {
  const memberDb = environment.authenticatedContext('member-a').firestore();
  const adminDb = environment.authenticatedContext('admin-a').firestore();
  await assertFails(deleteDoc(doc(memberDb, 'issues', 'issue-a')));
  await assertFails(deleteDoc(doc(adminDb, 'issues', 'issue-a')));
});

test('the issue trash is server-only, including for organization admins', async () => {
  const memberDb = environment.authenticatedContext('member-a').firestore();
  const adminDb = environment.authenticatedContext('admin-a').firestore();
  const memberTrash = doc(memberDb, 'deletedIssues', 'org-a_issue-a');
  const adminTrash = doc(adminDb, 'deletedIssues', 'org-a_issue-a');
  await assertFails(getDoc(memberTrash));
  await assertFails(getDoc(adminTrash));
  await assertFails(setDoc(adminTrash, {
    organizationId: 'org-a', issueId: 'issue-a', issue: { title: 'Forged' },
  }));
});

// The list is shorter than it was, and deliberately. `spentMinutes`, its two
// mirror counters and `timeLogMutationVersion` were named here because the
// server owned them; the product no longer has time logs, so the fields are not
// server-owned any more — they are simply not fields. The rule denies a fixed
// list of keys, so an unlisted name is writable exactly the way `title` is, and
// asserting a denial for a key nothing reads would be testing a typo.
test('issue execution fields can only be changed by the authoritative status API', async () => {
  const memberDb = environment.authenticatedContext('member-a').firestore();
  const issueRef = doc(memberDb, 'issues', 'issue-a');
  await assertSucceeds(updateDoc(issueRef, { title: 'Updated title' }));
  await assertFails(updateDoc(issueRef, { status: 'done' }));
  await assertFails(updateDoc(issueRef, { columnId: 'done' }));
  await assertFails(updateDoc(issueRef, { completedAt: new Date() }));
  await assertFails(updateDoc(issueRef, { order: 10 }));
});

test('an inactive QuickTeam add-on closes existing staff and client sessions', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'organizations', 'org-a'), {
      quickTeam: { sourceOrganizationId: 'quickteam-org-a', entitlement: 'inactive' },
    });
  });

  const ownerDb = environment.authenticatedContext('owner-a').firestore();
  const clientDb = environment.authenticatedContext('client-admin-a').firestore();
  await assertFails(getDoc(doc(ownerDb, 'organizations', 'org-a')));
  await assertFails(getDoc(doc(ownerDb, 'projects', 'project-a')));
  await assertFails(getDoc(doc(clientDb, 'issues', 'issue-a')));
  // The person can still reach their own account record to sign out or recover;
  // only the add-on workspace is closed.
  await assertSucceeds(getDoc(doc(ownerDb, 'users', 'owner-a')));

  await environment.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'organizations', 'org-a'), {
      quickTeam: { sourceOrganizationId: 'quickteam-org-a', entitlement: 'active' },
    });
  });
  await assertSucceeds(getDoc(doc(ownerDb, 'projects', 'project-a')));
  await assertSucceeds(getDoc(doc(clientDb, 'issues', 'issue-a')));
});

test('a stale project roster entry never replaces a live organization seat', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await deleteDoc(doc(context.firestore(), 'orgMemberships', 'org-a_client-member-a'));
  });
  const removedClientDb = environment.authenticatedContext('client-member-a').firestore();
  await assertFails(getDoc(doc(removedClientDb, 'projects', 'project-a')));
  await assertFails(getDoc(doc(removedClientDb, 'issues', 'issue-a')));
  await assertFails(getDoc(doc(removedClientDb, 'issues', 'issue-a', 'comments', 'member-comment')));
});

test('qTicket clients read their project and write its conversation, but cannot mutate the incident', async () => {
  for (const uid of ['client-admin-a', 'client-member-a']) {
    const db = environment.authenticatedContext(uid).firestore();
    const issueRef = doc(db, 'issues', 'issue-a');
    await assertSucceeds(getDoc(issueRef));
    await assertFails(updateDoc(issueRef, { title: 'Client rewrite' }));
    await assertFails(updateDoc(issueRef, { status: 'done' }));
    await assertSucceeds(setDoc(doc(db, 'issues', 'issue-a', 'comments', `${uid}-comment`), {
      authorId: uid,
      text: 'Client reply',
    }));
    // Somebody else's message is still somebody else's.
    await assertFails(setDoc(doc(db, 'issues', 'issue-a', 'comments', `${uid}-forged`), {
      authorId: 'member-a',
      text: 'Signed with a name that is not mine',
    }));
  }
});

// The owner's rule, in the only place that can enforce it: everything support
// writes in an incident, the client reads. There is no staff-only half of the
// conversation to be kept from them — the collection that held one is deleted,
// and a comment carries no visibility flag to hide behind.
test('a client reads every message on an incident they can reach', async () => {
  for (const uid of ['client-admin-a', 'client-member-a']) {
    const db = environment.authenticatedContext(uid).firestore();
    // Written by support, before this client ever opened the incident.
    await assertSucceeds(getDoc(doc(db, 'issues', 'issue-a', 'comments', 'member-comment')));
    await assertSucceeds(getDoc(doc(db, 'issues', 'issue-a', 'comments', 'owner-comment')));
    await assertSucceeds(getDocs(collection(db, 'issues', 'issue-a', 'comments')));
  }
});

// What stays support-side, and the reason it is not the conversation: the
// change history is the work record — who reassigned the incident, who moved
// it — and the customer is shown the current status instead.
test('the change history beside the conversation stays support-side', async () => {
  const memberDb = environment.authenticatedContext('member-a').firestore();
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'issues', 'issue-a', 'audit', 'reassigned'), {
      userId: 'member-a', action: 'assignee_changed',
    });
  });
  await assertSucceeds(getDoc(doc(memberDb, 'issues', 'issue-a', 'audit', 'reassigned')));
  for (const uid of ['client-admin-a', 'client-member-a']) {
    const clientDb = environment.authenticatedContext(uid).firestore();
    await assertFails(getDoc(doc(clientDb, 'issues', 'issue-a', 'audit', 'reassigned')));
    await assertFails(getDocs(collection(clientDb, 'issues', 'issue-a', 'audit')));
  }
});

// ── The incident conversation, in the shape the product actually writes ──────
//
// The `setDoc` above is not a shape the product ever sends. `addComment` writes
// the message *and* the incident's conversation metadata inside one
// `runTransaction`, and Firestore authorizes every write of a transaction
// separately and fails the whole transaction when one of them is refused — so a
// rule that allowed only the comment allowed nothing. The test above passed
// while «Надіслати» in the client portal returned «Missing or insufficient
// permissions» to every external client, on the one action the portal exists
// for. These three send what the browser sends.
const CLIENT_REPLY_TEXT = 'Проблема повторилась сьогодні вранці';

function clientReplyDocument(uid) {
  return {
    authorId: uid,
    authorName: 'Клієнт',
    authorAvatar: null,
    text: CLIENT_REPLY_TEXT,
    attachments: [],
    issueMentions: [],
    readBy: [uid],
    replyTo: null,
    createdAt: serverTimestamp(),
  };
}

// Exactly the patch `useComments.addComment` puts on the parent incident.
function conversationMetadataPatch(uid) {
  return {
    commentCount: increment(1),
    updatedAt: serverTimestamp(),
    lastActivityType: 'comment',
    lastActivityAt: serverTimestamp(),
    lastActivityActorId: uid,
    lastActivityActorName: 'Клієнт',
    lastActivityActorAvatar: null,
    lastActivityText: CLIENT_REPLY_TEXT,
    lastCommentAt: serverTimestamp(),
    lastCommentAuthorId: uid,
    lastCommentMentionIds: ['member-a'],
    lastCommentReadBy: [uid],
    'unreadMentions.member-a': increment(1),
  };
}

function sendClientReply(db, uid, commentId, extraIssueFields = {}) {
  return runTransaction(db, async transaction => {
    const issueRef = doc(db, 'issues', 'issue-a');
    const issueSnap = await transaction.get(issueRef);
    assert.ok(issueSnap.exists());
    transaction.set(doc(db, 'issues', 'issue-a', 'comments', commentId), clientReplyDocument(uid));
    transaction.update(issueRef, { ...conversationMetadataPatch(uid), ...extraIssueFields });
  });
}

test('a client sends a reply the way the product sends it: the message and the incident conversation metadata in one transaction', async () => {
  for (const uid of ['client-admin-a', 'client-member-a']) {
    const db = environment.authenticatedContext(uid).firestore();
    await assertSucceeds(sendClientReply(db, uid, `${uid}-transactional-reply`));
  }
});

test('a reply is not a way to move an incident: one workflow field refuses the whole transaction', async () => {
  const db = environment.authenticatedContext('client-admin-a').firestore();
  // Everything the customer must never touch, sent as a passenger on the write
  // they are allowed to make. `hasOnly` is what refuses each of them, and the
  // server-only denial list above still refuses the first five to everybody.
  const forbidden = [
    { status: 'done' },
    { columnId: 'done' },
    { archivedAt: Timestamp.fromDate(new Date()) },
    { cancelledAt: Timestamp.fromDate(new Date()) },
    { spentMinutes: 0 },
    { assigneeIds: ['client-admin-a'] },
    { priority: 'urgent' },
    { labelIds: ['vip'] },
    { dueDate: Timestamp.fromDate(new Date('2026-09-01T00:00:00Z')) },
    { watcherIds: ['client-admin-a'] },
    { title: 'Переписано клієнтом' },
  ];
  for (const smuggled of forbidden) {
    await assertFails(sendClientReply(db, 'client-admin-a', 'smuggled-reply', smuggled));
  }
  // And the incident is untouched: the refusal is the whole write, not the
  // conversation half landing and the workflow half bouncing.
  await environment.withSecurityRulesDisabled(async context => {
    const issue = await getDoc(doc(context.firestore(), 'issues', 'issue-a'));
    assert.equal(issue.data().status, undefined);
    assert.equal(issue.data().commentCount, undefined);
  });
});

test('a client removes their own message and marks a staff reply read, both the way the product does', async () => {
  const uid = 'client-member-a';
  const db = environment.authenticatedContext(uid).firestore();
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'issues', 'issue-a', 'comments', 'client-own-reply'), {
      authorId: uid, text: 'Написав зайве', createdAt: new Date(),
    });
    await updateDoc(doc(context.firestore(), 'issues', 'issue-a'), { commentCount: 3 });
  });

  // `useComments.deleteComment`: the message and the counter leave together.
  await assertSucceeds(runTransaction(db, async transaction => {
    const issueRef = doc(db, 'issues', 'issue-a');
    await transaction.get(issueRef);
    transaction.delete(doc(db, 'issues', 'issue-a', 'comments', 'client-own-reply'));
    transaction.update(issueRef, { commentCount: 2, updatedAt: serverTimestamp() });
  }));

  // `useComments.markCommentsRead`: the receipt on the message and the tally on
  // the incident, in one batch. Its failure was swallowed, so support never
  // learned that the customer had read anything at all.
  const batch = writeBatch(db);
  batch.update(doc(db, 'issues', 'issue-a', 'comments', 'member-comment'), {
    readBy: arrayUnion(uid),
    [`readAt.${uid}`]: serverTimestamp(),
  });
  batch.update(doc(db, 'issues', 'issue-a'), {
    lastCommentReadBy: arrayUnion(uid),
    [`unreadMentions.${uid}`]: deleteField(),
  });
  await assertSucceeds(batch.commit());
});

// The organization chat is not gated any more, it is gone: there is no
// `channels` collection, no rule for one, and therefore nothing there for any
// role to reach. What still has to hold is the tenancy line between one client
// and another.
test('a client cannot reach another client project, and no chat room exists to reach', async () => {
  const clientDb = environment.authenticatedContext('client-member-a').firestore();
  const otherClientDb = environment.authenticatedContext('client-other').firestore();
  const memberDb = environment.authenticatedContext('member-a').firestore();
  await assertFails(getDoc(doc(otherClientDb, 'projects', 'project-a')));
  await assertFails(getDoc(doc(otherClientDb, 'issues', 'issue-a')));
  // Denied to everybody, staff included — the default rule, because no rule
  // names this path any more.
  for (const db of [clientDb, memberDb]) {
    await assertFails(getDoc(doc(db, 'organizations', 'org-a', 'channels', 'general')));
    await assertFails(setDoc(doc(db, 'organizations', 'org-a', 'channels', 'general'), {
      name: 'general', type: 'public',
    }));
  }
});

test('task time-log writes are owned by authenticated server APIs', async () => {
  const db = environment.authenticatedContext('member-a').firestore();
  await assertFails(setDoc(doc(db, 'timeLogs', 'member-log'), {
    organizationId: 'org-a', projectId: 'project-a', issueId: 'issue-a',
    userId: 'member-a', spentMinutes: 15,
  }));
  await assertFails(setDoc(doc(db, 'timeLogs', 'forged-log'), {
    organizationId: 'org-a', projectId: 'project-a', issueId: 'issue-a',
    userId: 'owner-a', spentMinutes: 999,
  }));
  await assertFails(updateDoc(doc(db, 'timeLogs', 'log-owner'), { spentMinutes: 999 }));
});

test('time logs require bounded positive integer minutes and clients cannot forge billing metadata', async () => {
  const db = environment.authenticatedContext('member-a').firestore();
  const base = {
    organizationId: 'org-a',
    projectId: 'project-a',
    issueId: 'issue-a',
    userId: 'member-a',
  };
  await assertFails(setDoc(doc(db, 'timeLogs', 'negative-log'), {
    ...base,
    spentMinutes: -15,
  }));
  await assertFails(setDoc(doc(db, 'timeLogs', 'fractional-log'), {
    ...base,
    spentMinutes: 1.5,
  }));
  await assertFails(setDoc(doc(db, 'timeLogs', 'huge-log'), {
    ...base,
    spentMinutes: 525601,
  }));
  await assertFails(setDoc(doc(db, 'timeLogs', 'forged-billed-log'), {
    ...base,
    spentMinutes: 15,
    invoiceId: 'invoice-a',
    billedAt: new Date(),
  }));
  await assertFails(setDoc(doc(db, 'timeLogs', 'orphan-log'), {
    ...base,
    issueId: '',
    spentMinutes: 15,
  }));
  await assertFails(setDoc(doc(db, 'timeLogs', 'task-disguised-as-event'), {
    ...base,
    sourceType: 'calendar_event',
    eventId: 'event-a',
    occurrenceStartAt: '2026-07-25T09:00:00.000Z',
    spentMinutes: 15,
  }));
});

test('billed time logs are immutable even for their author and organization owner', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'timeLogs', 'billed-log'), {
      organizationId: 'org-a',
      projectId: 'project-a',
      issueId: 'issue-a',
      userId: 'owner-a',
      spentMinutes: 30,
      invoiceId: 'invoice-a',
      billedAt: new Date(),
    });
  });
  const ownerDb = environment.authenticatedContext('owner-a').firestore();
  const billedRef = doc(ownerDb, 'timeLogs', 'billed-log');
  await assertFails(updateDoc(billedRef, { description: 'Changed' }));
  await assertFails(updateDoc(billedRef, { invoiceId: deleteField() }));
  await assertFails(deleteDoc(billedRef));
});

test('task time logs require a live issue in the same project and organization', async () => {
  const db = environment.authenticatedContext('member-a').firestore();
  await assertFails(setDoc(doc(db, 'timeLogs', 'missing-issue-log'), {
    organizationId: 'org-a', projectId: 'project-a', issueId: 'missing',
    userId: 'member-a', spentMinutes: 15,
  }));
  await assertFails(setDoc(doc(db, 'timeLogs', 'wrong-project-log'), {
    organizationId: 'org-a', projectId: 'project-b', issueId: 'issue-a',
    userId: 'member-a', spentMinutes: 15,
  }));

  await environment.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'issues', 'issue-a'), {
      deletionPending: true,
    });
  });
  await assertFails(setDoc(doc(db, 'timeLogs', 'deleting-issue-log'), {
    organizationId: 'org-a', projectId: 'project-a', issueId: 'issue-a',
    userId: 'member-a', spentMinutes: 15,
  }));
});

test('authors can delete their own comments but not another authors comments', async () => {
  const db = environment.authenticatedContext('member-a').firestore();
  await assertSucceeds(deleteDoc(doc(db, 'issues', 'issue-a', 'comments', 'member-comment')));
  await assertFails(deleteDoc(doc(db, 'issues', 'issue-a', 'comments', 'owner-comment')));
});

test('a browser cannot archive a task by writing the field itself', async () => {
  // Archiving goes through /api/issues/[issueId]/archive, which also writes the
  // history entry. A client that could set the field would archive silently.
  const db = environment.authenticatedContext('member-a').firestore();
  const ref = doc(db, 'issues', 'issue-a');
  await assertFails(updateDoc(ref, { archivedAt: new Date() }));
  await assertFails(updateDoc(ref, { archivedBy: 'member-a' }));
  // An ordinary field on the same document still writes, so this is the field
  // being refused rather than the whole task being read-only.
  await assertSucceeds(updateDoc(ref, { title: 'Still editable' }));
});

test('the legacy tasks collection is closed to browsers', async () => {
  // It used to authorize any member of the organization, with no project scope —
  // the last org-wide read path in the workspace. Nothing reads it any more.
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'tasks', 'legacy-task'), {
      organizationId: 'org-a', title: 'Legacy',
    });
  });
  for (const uid of ['member-a', 'admin-a', 'owner-a']) {
    const db = environment.authenticatedContext(uid).firestore();
    await assertFails(getDoc(doc(db, 'tasks', 'legacy-task')));
  }
});

test('a reader stamps when they read a comment, and may touch nothing else on it', async () => {
  const memberDb = environment.authenticatedContext('member-a').firestore();
  const commentRef = doc(memberDb, 'issues', 'issue-a', 'comments', 'owner-comment');

  // The receipt is two fields written together: who has read it, and when they
  // did. The ticks under a sent message could only ever say «прочитано», which
  // is the half of the question a sender is not asking.
  await assertSucceeds(updateDoc(commentRef, {
    readBy: arrayUnion('member-a'),
    'readAt.member-a': serverTimestamp(),
  }));
  // And nothing beyond them: a read receipt is not a way into somebody else's
  // words.
  await assertFails(updateDoc(commentRef, {
    readBy: arrayUnion('member-a'),
    text: 'Rewritten while marking it read',
  }));
});

test('an admin removes a comment they did not write, but cannot rewrite it', async () => {
  const adminDb = environment.authenticatedContext('admin-a').firestore();
  const memberDb = environment.authenticatedContext('member-a').firestore();
  const commentRef = db => doc(db, 'issues', 'issue-a', 'comments', 'moderated-comment');
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(commentRef(context.firestore()), {
      authorId: 'owner-a', text: 'Something that should not stand', createdAt: new Date(),
    });
  });

  // A plain member on the project can read it and still may not remove it.
  await assertFails(deleteDoc(commentRef(memberDb)));
  // Editing stays with the author even for an admin: the comment carries the
  // author's name either way, so nobody else may put words in it.
  await assertFails(updateDoc(commentRef(adminDb), { text: 'Rewritten by an admin' }));
  await assertSucceeds(deleteDoc(commentRef(adminDb)));
});

test('clients cannot delete task time logs, including their own', async () => {
  const memberDb = environment.authenticatedContext('member-a').firestore();
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'timeLogs', 'member-log-delete'), {
      organizationId: 'org-a', projectId: 'project-a', issueId: 'issue-a',
      userId: 'member-a', spentMinutes: 10,
    });
  });
  await assertFails(deleteDoc(doc(memberDb, 'timeLogs', 'member-log-delete')));
  await assertFails(deleteDoc(doc(memberDb, 'timeLogs', 'log-owner')));
});

test('direct time-log creation stays denied throughout project deletion', async () => {
  const memberDb = environment.authenticatedContext('member-a').firestore();
  const log = {
    organizationId: 'org-a',
    projectId: 'project-a',
    issueId: 'issue-a',
    userId: 'member-a',
    spentMinutes: 15,
  };
  await assertFails(setDoc(doc(memberDb, 'timeLogs', 'before-project-delete'), log));

  await environment.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'projects', 'project-a'), {
      deletionPending: true,
    });
  });
  await assertFails(setDoc(doc(memberDb, 'timeLogs', 'after-project-delete'), log));
});

test('calendar source documents are server-only for staff and client browsers', async () => {
  for (const uid of ['owner-a', 'member-a', 'client-admin-a', 'client-member-a']) {
    const db = environment.authenticatedContext(uid).firestore();
    await assertFails(getDoc(doc(db, 'calendarEvents', 'staff-meeting')));
    await assertFails(getDocs(query(
      collection(db, 'calendarEvents'),
      where('organizationId', '==', 'org-a'),
    )));
    await assertFails(setDoc(doc(db, 'calendarEvents', `${uid}-forged-event`), {
      organizationId: 'org-a',
      organizerId: uid,
      participantIds: [uid],
      title: 'Forged event',
      visibility: 'team',
    }));
  }
});

test('issue audit history is staff-only and clients cannot forge entries', async () => {
  const clientDb = environment.authenticatedContext('client-admin-a').firestore();
  const memberDb = environment.authenticatedContext('member-a').firestore();
  const clientAuditRef = doc(clientDb, 'issues', 'issue-a', 'audit', 'client-forged-audit');
  const memberAuditRef = doc(memberDb, 'issues', 'issue-a', 'audit', 'member-audit');

  await assertFails(setDoc(clientAuditRef, {
    userId: 'client-admin-a',
    type: 'status_changed',
    from: 'new',
    to: 'resolved',
  }));
  await assertSucceeds(setDoc(memberAuditRef, {
    userId: 'member-a',
    type: 'status_changed',
    from: 'new',
    to: 'resolved',
  }));
  await assertSucceeds(getDoc(doc(memberDb, 'issues', 'issue-a', 'audit', 'member-audit')));
  await assertFails(getDoc(doc(clientDb, 'issues', 'issue-a', 'audit', 'member-audit')));
});

// A summary of hours you may not see is still those hours. The daily totals
// repeat the raw log's rule rather than relaxing it, and nothing in a browser
// may write one — they are derived by server transactions and rebuilt by
// scripts/backfill-analytics-rollups.mjs.
test('notifications can only be created by the server API', async () => {
  const db = environment.authenticatedContext('member-a').firestore();
  await assertFails(setDoc(doc(db, 'notifications', 'same-org'), {
    userId: 'owner-a', actorId: 'member-a', organizationId: 'org-a',
    title: 'Hello', body: '', read: false,
  }));
  await assertFails(setDoc(doc(db, 'notifications', 'outsider'), {
    userId: 'outsider', actorId: 'member-a', organizationId: 'org-a',
    title: 'Spam', body: '', read: false,
  }));
  await assertFails(setDoc(doc(db, 'notifications', 'spoofed'), {
    userId: 'owner-a', actorId: 'admin-a', organizationId: 'org-a',
    title: 'Spoofed', body: '', read: false,
  }));
});

test('a recipient can only toggle the read state of a notification', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'notifications', 'recipient-notification'), {
      userId: 'member-a', title: 'Original', body: 'Body', read: false,
    });
  });
  const db = environment.authenticatedContext('member-a').firestore();
  await assertSucceeds(updateDoc(doc(db, 'notifications', 'recipient-notification'), { read: true }));
  await assertFails(updateDoc(doc(db, 'notifications', 'recipient-notification'), { title: 'Rewritten' }));
  await assertFails(updateDoc(doc(db, 'notifications', 'recipient-notification'), { userId: 'owner-a' }));
});

test('user profiles are private even between organization members', async () => {
  const memberDb = environment.authenticatedContext('member-a').firestore();
  await assertSucceeds(getDoc(doc(memberDb, 'users', 'member-a')));
  await assertFails(getDoc(doc(memberDb, 'users', 'owner-a')));
});

test('presence is organization-scoped and users can only write their own state', async () => {
  const memberDb = environment.authenticatedContext('member-a').firestore();
  const outsiderDb = environment.authenticatedContext('outsider').firestore();
  const ownPresence = doc(memberDb, 'organizations', 'org-a', 'presence', 'member-a');
  await assertSucceeds(setDoc(ownPresence, { online: true }));
  await assertSucceeds(getDoc(ownPresence));
  await assertFails(setDoc(doc(memberDb, 'organizations', 'org-a', 'presence', 'owner-a'), { online: false }));
  await assertFails(getDoc(doc(outsiderDb, 'organizations', 'org-a', 'presence', 'member-a')));
  await assertFails(setDoc(doc(memberDb, 'presence', 'member-a'), { online: true }));
});

test('organization bootstrap is a server route, not a rule', async () => {
  // It used to be both documents from the browser, guarded by «the organization
  // names you as its owner». That guard is true of the tenth free workspace an
  // account creates as well, and «one free workspace per account» is a count no
  // rule can make — so /api/organizations writes the pair, and the rate the old
  // bootstrap had to be told not to accept has no client path to arrive by.
  const db = environment.authenticatedContext('founder').firestore();
  await assertFails(setDoc(doc(db, 'organizations', 'org-new'), {
    ownerId: 'founder', name: 'New Org',
  }));
  await assertFails(setDoc(doc(db, 'orgMemberships', 'org-new_founder'), {
    id: 'org-new_founder', orgId: 'org-new', userId: 'founder', role: 'owner',
  }));
  await assertFails(setDoc(doc(db, 'orgMemberships', 'org-new_founder'), {
    id: 'org-new_founder', orgId: 'org-new', userId: 'founder', role: 'owner', hourlyRate: 100,
  }));
});

test('issues and project lifecycle mutations cannot bypass server APIs', async () => {
  const memberDb = environment.authenticatedContext('member-a').firestore();
  const adminDb = environment.authenticatedContext('admin-a').firestore();
  await assertFails(setDoc(doc(memberDb, 'issues', 'client-created'), {
    organizationId: 'org-a', projectId: 'project-a', title: 'Bypass',
  }));
  await assertFails(updateDoc(doc(adminDb, 'projects', 'project-a'), { status: 'archived' }));
  await assertFails(deleteDoc(doc(adminDb, 'projects', 'project-a')));
  await assertSucceeds(updateDoc(doc(adminDb, 'projects', 'project-a'), { name: 'Renamed' }));
  await assertFails(updateDoc(doc(adminDb, 'projects', 'project-a'), { issueCounter: 99 }));
  // The progress bar a card draws, once it stops reading the tasks behind it.
  // A browser that could set this could draw any number it liked.
  await assertFails(updateDoc(doc(adminDb, 'projects', 'project-a'), {
    issueCounts: { version: 1, total: 999, delivered: 999, overdue: 0 },
  }));
  await assertFails(updateDoc(doc(adminDb, 'projects', 'project-a'), { 'issueCounts.total': 999 }));
  await assertFails(updateDoc(doc(adminDb, 'projects', 'project-a'), { issueLinkVersion: 99 }));
  await assertFails(updateDoc(doc(adminDb, 'projects', 'project-a'), { issueHierarchyVersion: 99 }));
  await assertFails(updateDoc(doc(adminDb, 'projects', 'project-a'), { issueStatusVersion: 99 }));
  await assertFails(updateDoc(doc(adminDb, 'projects', 'project-a'), { deletionPending: true }));
});

test('the two reads the dashboard has left are allowed, and stay scoped', async () => {
  const memberDb = environment.authenticatedContext('member-a').firestore();
  const offTeamDb = environment.authenticatedContext('member-offteam').firestore();
  const issues = collection(memberDb, 'issues');

  // The featured card's activity query: one project, ordered, limited. Rules
  // are not filters, so it has to carry the same scope the read rule checks.
  await assertSucceeds(getDocs(query(
    issues,
    where('organizationId', '==', 'org-a'),
    where('projectId', '==', 'project-a'),
  )));

  // The hidden-column count inside BoardConfigModal. An aggregate is a read:
  // it is refused exactly where reading the documents would be, which is what
  // stops a count being a way to measure a project you cannot open.
  await assertSucceeds(getCountFromServer(query(
    issues,
    where('organizationId', '==', 'org-a'),
    where('projectId', '==', 'project-a'),
    where('columnId', 'in', ['done', 'review']),
  )));
  await assertFails(getCountFromServer(query(
    collection(offTeamDb, 'issues'),
    where('organizationId', '==', 'org-a'),
    where('projectId', '==', 'project-a'),
    where('columnId', 'in', ['done', 'review']),
  )));
  // And an unscoped count is refused for everybody, member or not.
  await assertFails(getCountFromServer(issues));
});

test('deletion markers freeze nested writes before non-atomic cascades', async () => {
  const memberDb = environment.authenticatedContext('member-a').firestore();
  const commentRef = doc(memberDb, 'issues', 'issue-a', 'comments', 'pending-comment');
  const auditRef = doc(memberDb, 'issues', 'issue-a', 'audit', 'pending-audit');
  const materialRef = doc(memberDb, 'stages', 'stage-a', 'materials', 'material-a');

  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'stages', 'stage-a'), {
      projectId: 'project-a',
      title: 'Stage A',
    });
  });
  await assertSucceeds(setDoc(commentRef, {
    authorId: 'member-a',
    text: 'Before deletion',
  }));
  await assertSucceeds(setDoc(auditRef, {
    userId: 'member-a',
    action: 'before_deletion',
  }));
  await assertSucceeds(setDoc(materialRef, {
    title: 'Before deletion',
  }));

  await environment.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'projects', 'project-a'), {
      deletionPending: true,
    });
  });

  await assertFails(setDoc(doc(
    memberDb,
    'stages',
    'stage-a',
    'materials',
    'late-material',
  ), {
    title: 'Too late',
  }));
  await assertFails(updateDoc(materialRef, { title: 'Too late' }));
  await assertFails(deleteDoc(materialRef));
  await assertFails(updateDoc(doc(memberDb, 'stages', 'stage-a'), {
    title: 'Too late',
  }));
  await assertFails(setDoc(doc(
    memberDb,
    'issues',
    'issue-a',
    'comments',
    'late-comment',
  ), {
    authorId: 'member-a',
    text: 'Too late',
  }));
  await assertFails(updateDoc(commentRef, { text: 'Too late' }));
  await assertFails(deleteDoc(commentRef));
  await assertFails(setDoc(doc(
    memberDb,
    'issues',
    'issue-a',
    'audit',
    'late-audit',
  ), {
    userId: 'member-a',
    action: 'too_late',
  }));
  await assertFails(updateDoc(doc(memberDb, 'issues', 'issue-a'), {
    title: 'Too late',
  }));

  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await updateDoc(doc(db, 'projects', 'project-a'), {
      deletionPending: false,
    });
    await updateDoc(doc(db, 'issues', 'issue-a'), {
      deletionPending: true,
    });
  });
  await assertFails(setDoc(doc(
    memberDb,
    'issues',
    'issue-a',
    'comments',
    'issue-late-comment',
  ), {
    authorId: 'member-a',
    text: 'Too late',
  }));
  await assertFails(setDoc(doc(
    memberDb,
    'issues',
    'issue-a',
    'audit',
    'issue-late-audit',
  ), {
    userId: 'member-a',
    action: 'too_late',
  }));
});

test('issue hierarchy and legacy subtasks can only be changed by server APIs', async () => {
  const memberDb = environment.authenticatedContext('member-a').firestore();
  const adminDb = environment.authenticatedContext('admin-a').firestore();
  await assertFails(updateDoc(doc(memberDb, 'issues', 'issue-a'), {
    parentIssueId: 'issue-parent',
  }));
  await assertFails(updateDoc(doc(adminDb, 'issues', 'issue-a'), {
    parentEpicId: 'legacy-parent',
  }));
  await assertFails(updateDoc(doc(memberDb, 'issues', 'issue-a'), {
    subtasks: [{ title: 'Обхід API', done: false }],
  }));
  await assertFails(updateDoc(doc(adminDb, 'issues', 'issue-a'), {
    deletionPending: true,
  }));
  await assertSucceeds(updateDoc(doc(memberDb, 'issues', 'issue-a'), {
    title: 'Дозволене редагування',
  }));
});

test('clients cannot promote regular issues to epic while legacy epics remain editable', async () => {
  const memberDb = environment.authenticatedContext('member-a').firestore();
  await assertFails(updateDoc(doc(memberDb, 'issues', 'issue-a'), { type: 'epic' }));

  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'issues', 'legacy-epic'), {
      organizationId: 'org-a',
      projectId: 'project-a',
      title: 'Legacy epic',
      type: 'epic',
    });
  });
  await assertSucceeds(updateDoc(doc(memberDb, 'issues', 'legacy-epic'), {
    title: 'Edited legacy epic',
  }));
  await assertSucceeds(updateDoc(doc(memberDb, 'issues', 'legacy-epic'), {
    type: 'task',
  }));
});

test('issue links are readable but all client writes go through the canonical API', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'issueLinks', 'link-a'), {
      schemaVersion: 2,
      organizationId: 'org-a',
      projectId: 'project-a',
      sourceIssueId: 'issue-a',
      targetIssueId: 'issue-b',
      relationType: 'blocks',
    });
  });
  const memberDb = environment.authenticatedContext('member-a').firestore();
  const adminDb = environment.authenticatedContext('admin-a').firestore();
  await assertSucceeds(getDoc(doc(memberDb, 'issueLinks', 'link-a')));
  await assertFails(setDoc(doc(memberDb, 'issueLinks', 'forged'), {
    schemaVersion: 2,
    organizationId: 'org-a',
    projectId: 'project-a',
    sourceIssueId: 'issue-a',
    targetIssueId: 'issue-b',
    relationType: 'blocks',
  }));
  await assertFails(updateDoc(doc(adminDb, 'issueLinks', 'link-a'), {
    relationType: 'duplicates',
  }));
  await assertFails(deleteDoc(doc(adminDb, 'issueLinks', 'link-a')));
});

test('issue links stay listable for the projects a user can already open', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'projects', 'project-locked'), {
      organizationId: 'org-a',
      name: 'Locked',
      status: 'active',
      team: ['owner-a'],
    });
    for (const [id, projectId] of [
      ['list-link-a', 'project-a'],
      ['list-link-b', 'project-a'],
      ['list-link-locked', 'project-locked'],
    ]) {
      await setDoc(doc(db, 'issueLinks', id), {
        schemaVersion: 2,
        organizationId: 'org-a',
        projectId,
        sourceIssueId: 'issue-a',
        targetIssueId: 'issue-b',
        relationType: 'blocks',
      });
    }
  });

  const scopedLinks = (db, projectIds) => query(
    collection(db, 'issueLinks'),
    where('organizationId', '==', 'org-a'),
    where('projectId', 'in', projectIds),
  );

  // The workspace only ever asks for links of projects it already resolved,
  // so this is the shape every hook has to keep using.
  const memberDb = environment.authenticatedContext('member-a').firestore();
  const memberSnapshot = await assertSucceeds(getDocs(scopedLinks(memberDb, ['project-a'])));
  assert.equal(memberSnapshot.size, 2);

  // An owner sees both projects, and the unscoped query still has to work for
  // them — reading resource.data.projectId directly used to fail it outright.
  const ownerDb = environment.authenticatedContext('owner-a').firestore();
  const ownerSnapshot = await assertSucceeds(getDocs(query(
    collection(ownerDb, 'issueLinks'),
    where('organizationId', '==', 'org-a'),
  )));
  assert.equal(ownerSnapshot.size, 3);

  // Scoping is still enforced: a member cannot widen the query to a project
  // whose team they are not on.
  await assertFails(getDocs(scopedLinks(memberDb, ['project-a', 'project-locked'])));
  await assertFails(getDocs(query(
    collection(environment.authenticatedContext('member-offteam').firestore(), 'issueLinks'),
    where('organizationId', '==', 'org-a'),
    where('projectId', 'in', ['project-a']),
  )));
});

test('project-scoped data follows live team membership while admins retain access', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'projects', 'scoped-project'), {
      organizationId: 'org-a',
      name: 'Scoped project',
      status: 'active',
      team: ['member-a'],
    });
    await setDoc(doc(db, 'issues', 'scoped-issue'), {
      organizationId: 'org-a',
      projectId: 'scoped-project',
      title: 'Scoped issue',
      type: 'task',
    });
    await setDoc(doc(db, 'issues', 'scoped-issue', 'comments', 'comment-a'), {
      authorId: 'member-a',
      text: 'Scoped comment',
    });
    await setDoc(doc(db, 'issues', 'scoped-issue', 'audit', 'audit-a'), {
      userId: 'member-a',
      action: 'created',
    });
    await setDoc(doc(db, 'stages', 'scoped-stage'), {
      projectId: 'scoped-project',
      title: 'Scoped stage',
    });
    await setDoc(doc(db, 'stages', 'scoped-stage', 'materials', 'material-a'), {
      title: 'Scoped material',
    });
    await setDoc(doc(db, 'issueLinks', 'scoped-link'), {
      schemaVersion: 2,
      organizationId: 'org-a',
      projectId: 'scoped-project',
      sourceIssueId: 'scoped-issue',
      targetIssueId: 'scoped-issue-b',
      relationType: 'relates-to',
    });
  });

  const offTeamDb = environment.authenticatedContext('member-offteam').firestore();
  const teamDb = environment.authenticatedContext('member-a').firestore();
  const adminDb = environment.authenticatedContext('admin-a').firestore();
  const ownerDb = environment.authenticatedContext('owner-a').firestore();
  const issueRef = db => doc(db, 'issues', 'scoped-issue');
  const commentRef = db => doc(db, 'issues', 'scoped-issue', 'comments', 'comment-a');
  const auditRef = db => doc(db, 'issues', 'scoped-issue', 'audit', 'audit-a');
  const stageRef = db => doc(db, 'stages', 'scoped-stage');
  const materialRef = db => doc(db, 'stages', 'scoped-stage', 'materials', 'material-a');
  const linkRef = db => doc(db, 'issueLinks', 'scoped-link');

  await assertFails(getDoc(issueRef(offTeamDb)));
  await assertFails(getDocs(query(
    collection(offTeamDb, 'issues'),
    where('organizationId', '==', 'org-a'),
    where('projectId', '==', 'scoped-project'),
  )));
  await assertFails(updateDoc(issueRef(offTeamDb), { title: 'Forbidden' }));
  await assertFails(getDoc(commentRef(offTeamDb)));
  await assertFails(getDoc(auditRef(offTeamDb)));
  await assertFails(getDoc(stageRef(offTeamDb)));
  await assertFails(updateDoc(stageRef(offTeamDb), { title: 'Forbidden' }));
  await assertFails(getDoc(materialRef(offTeamDb)));
  await assertFails(updateDoc(materialRef(offTeamDb), { title: 'Forbidden' }));
  await assertFails(getDoc(linkRef(offTeamDb)));

  await assertSucceeds(getDoc(issueRef(teamDb)));
  await assertSucceeds(getDocs(query(
    collection(teamDb, 'issues'),
    where('organizationId', '==', 'org-a'),
    where('projectId', '==', 'scoped-project'),
  )));
  await assertSucceeds(updateDoc(issueRef(teamDb), { title: 'Team edit' }));
  await assertSucceeds(getDoc(commentRef(teamDb)));
  await assertSucceeds(getDoc(auditRef(teamDb)));
  await assertSucceeds(getDoc(stageRef(teamDb)));
  await assertSucceeds(updateDoc(stageRef(teamDb), { title: 'Team stage edit' }));
  await assertSucceeds(getDoc(materialRef(teamDb)));
  await assertSucceeds(updateDoc(materialRef(teamDb), { title: 'Team material edit' }));
  await assertSucceeds(getDoc(linkRef(teamDb)));
  await assertSucceeds(getDoc(issueRef(adminDb)));
  await assertSucceeds(getDoc(issueRef(ownerDb)));
});

test('projectless issues are restricted to organization owners and admins', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'issues', 'projectless-issue'), {
      organizationId: 'org-a',
      projectId: null,
      title: 'Projectless issue',
      type: 'task',
    });
  });
  const memberDb = environment.authenticatedContext('member-a').firestore();
  const adminDb = environment.authenticatedContext('admin-a').firestore();
  const ownerDb = environment.authenticatedContext('owner-a').firestore();

  await assertFails(getDoc(doc(memberDb, 'issues', 'projectless-issue')));
  await assertFails(updateDoc(doc(memberDb, 'issues', 'projectless-issue'), {
    title: 'Forbidden',
  }));
  await assertSucceeds(getDoc(doc(adminDb, 'issues', 'projectless-issue')));
  await assertSucceeds(getDoc(doc(ownerDb, 'issues', 'projectless-issue')));
  await assertSucceeds(updateDoc(doc(ownerDb, 'issues', 'projectless-issue'), {
    title: 'Owner edit',
  }));
});

test('project reads are gated by team membership for plain members', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'projects', 'project-team'), {
      organizationId: 'org-a', name: 'Team Project', status: 'active', team: ['member-a'],
    });
    await setDoc(doc(db, 'projects', 'project-foreign'), {
      organizationId: 'org-a', name: 'Foreign Project', status: 'active', team: ['owner-a'],
    });
    await setDoc(doc(db, 'projects', 'project-legacy'), {
      organizationId: 'org-a', name: 'Legacy Project', status: 'active',
    });
  });
  const memberDb = environment.authenticatedContext('member-a').firestore();
  const adminDb = environment.authenticatedContext('admin-a').firestore();
  const ownerDb = environment.authenticatedContext('owner-a').firestore();

  // A plain member may read only projects whose `team` contains them…
  await assertSucceeds(getDoc(doc(memberDb, 'projects', 'project-team')));
  await assertFails(getDoc(doc(memberDb, 'projects', 'project-foreign')));
  // …and a legacy project with no `team` field is invisible until backfilled.
  await assertFails(getDoc(doc(memberDb, 'projects', 'project-legacy')));
  await assertSucceeds(getDoc(doc(memberDb, 'projects', 'project-a')));

  // Owners and admins see every project regardless of team membership.
  await assertSucceeds(getDoc(doc(adminDb, 'projects', 'project-foreign')));
  await assertSucceeds(getDoc(doc(adminDb, 'projects', 'project-a')));
  await assertSucceeds(getDoc(doc(ownerDb, 'projects', 'project-foreign')));
});

test('a member on no project team gets an empty project list and cannot query all issues', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'projects', 'proj-owner-only'), {
      organizationId: 'org-a', name: 'Owner Only', status: 'active', team: ['owner-a'],
    });
  });
  const memberDb = environment.authenticatedContext('member-offteam').firestore();
  await assertSucceeds(getDocs(query(
    collection(memberDb, 'projects'),
    where('organizationId', '==', 'org-a'),
    where('team', 'array-contains', 'member-offteam'),
  )));
  await assertFails(getDocs(query(
    collection(memberDb, 'issues'),
    where('organizationId', '==', 'org-a'),
  )));
});

test('users/{uid}/settings stays reachable by its own owner', async () => {
  const db = environment.authenticatedContext('member-a').firestore();
  await assertSucceeds(setDoc(doc(db, 'users', 'member-a', 'settings', 'prefs'), { theme: 'dark' }));
  await assertSucceeds(getDoc(doc(db, 'users', 'member-a', 'settings', 'prefs')));
});

// An organization settings document other than `workflow` is readable by every
// member of that organization and writable only by an admin or the owner.
test('a member reads an org settings document but cannot write it', async () => {
  const memberDb = environment.authenticatedContext('member-a').firestore();
  await assertSucceeds(getDoc(doc(memberDb, 'organizations', 'org-a', 'settings', 'general')));
  await assertFails(setDoc(doc(memberDb, 'organizations', 'org-a', 'settings', 'general'), {
    updatedAtMs: 1,
  }));
});

test('an org admin writes an org settings document', async () => {
  const adminDb = environment.authenticatedContext('admin-a').firestore();
  await assertSucceeds(setDoc(doc(adminDb, 'organizations', 'org-a', 'settings', 'general'), {
    updatedAtMs: 1,
  }));
});

test('workflow settings are readable and writable only through the role-filtered server API', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(context.firestore(), 'organizations', 'org-a', 'settings', 'workflow'),
      { statuses: [{ id: 'backlog', label: 'Беклог' }] },
    );
  });
  const memberDb = environment.authenticatedContext('member-a').firestore();
  const adminDb = environment.authenticatedContext('admin-a').firestore();
  const workflowPath = ['organizations', 'org-a', 'settings', 'workflow'];

  await assertFails(getDoc(doc(memberDb, ...workflowPath)));
  await assertFails(getDoc(doc(adminDb, ...workflowPath)));
  await assertFails(setDoc(doc(memberDb, ...workflowPath), {
    statuses: [{ id: 'done', label: 'Готово', isDone: true }],
  }));
  await assertFails(setDoc(doc(adminDb, ...workflowPath), {
    statuses: [{ id: 'done', label: 'Готово', isDone: true }],
  }));
});

test('an outsider cannot read an org settings document', async () => {
  const db = environment.authenticatedContext('outsider').firestore();
  await assertFails(getDoc(doc(db, 'organizations', 'org-a', 'settings', 'general')));
});

// «Друкує…» in the one conversation the product has. The heartbeat lives on a
// document of its own rather than on the incident, because every board and card
// that shows the incident is subscribed to it and would pay a read for each
// beat — and the document holds nothing but the two fields, which is what the
// key check enforces.
test('anyone in the conversation may say they are typing, and write nothing else there', async () => {
  const typingRef = db => doc(db, 'issues', 'issue-a', 'presence', 'typing');

  for (const uid of ['member-a', 'client-member-a']) {
    const db = environment.authenticatedContext(uid).firestore();
    await assertSucceeds(setDoc(typingRef(db), { typing: [uid], typingAt: { [uid]: 1 } }));
    await assertSucceeds(getDoc(typingRef(db)));
    await assertFails(setDoc(typingRef(db), { typing: [uid], text: 'not a heartbeat' }));
  }

  // Somebody with no access to the project has no conversation to be typing in.
  const offTeamDb = environment.authenticatedContext('client-other').firestore();
  await assertFails(getDoc(typingRef(offTeamDb)));
  await assertFails(setDoc(typingRef(offTeamDb), { typing: ['client-other'], typingAt: {} }));
});

