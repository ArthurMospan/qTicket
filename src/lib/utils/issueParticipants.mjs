// src/lib/utils/issueParticipants.mjs
// Who hears about activity on a task.
//
// The rule every issue tracker converges on, and the one people already expect:
// you are a participant if you have a stake in the task — you created it, it is
// assigned to you, you are watching it, or you joined the conversation by
// commenting. Activity goes to participants and never back to whoever caused it.
//
// Before this existed each sender picked its own audience. A status change went
// to assignees and watchers only, so the person who *created* the task never
// heard that it moved, and comments notified nobody at all unless they carried
// an @mention.

// An imported task remembers who reported it in the system it came from, and
// that person is usually not a QuickTeam account at all: the YouTrack importer
// writes `external:youtrack:<connection>:<id>` for anyone it could not map to a
// member. Such an id is a label, not a recipient — and because
// /api/notifications rejects a batch outright when one recipient is not a
// member, letting one through meant nobody on the task heard anything.
//
// Firebase uids have no colon, so the namespace prefix is the whole test.
export function isExternalActorId(userId) {
  return typeof userId === 'string' && userId.includes(':');
}

export function issueParticipants(issue, {
  actorId = '',
  commentAuthorIds = [],
  exclude = [],
} = {}) {
  // The actor is always excluded: nobody wants to be told about their own click.
  // `exclude` carries people already reached another way — someone who is being
  // @mentioned gets the mention, not a second, vaguer notification as well.
  const excluded = new Set([actorId, ...exclude].filter(Boolean));

  const candidates = [
    ...(Array.isArray(issue?.assigneeIds) ? issue.assigneeIds : []),
    issue?.reporterId,
    ...(Array.isArray(issue?.watcherIds) ? issue.watcherIds : []),
    ...(Array.isArray(commentAuthorIds) ? commentAuthorIds : []),
  ];

  return [...new Set(
    candidates.filter(uid => (
      typeof uid === 'string'
      && uid.length > 0
      && !excluded.has(uid)
      && !isExternalActorId(uid)
    )),
  )];
}

export function issueDisplayParticipants(issue) {
  const participants = new Map();
  const addRole = (userId, role) => {
    if (typeof userId !== 'string' || userId.length === 0) return;
    const current = participants.get(userId) || { id: userId, roles: [] };
    if (!current.roles.includes(role)) current.roles.push(role);
    participants.set(userId, current);
  };

  const assigneeIds = Array.isArray(issue?.assigneeIds)
    ? issue.assigneeIds
    : Array.isArray(issue?.assignees)
      ? issue.assignees
      : [];
  assigneeIds.forEach(userId => addRole(userId, 'assignee'));
  addRole(issue?.reporterId || issue?.createdBy, 'author');

  const watcherIds = Array.isArray(issue?.watcherIds)
    ? issue.watcherIds
    : Array.isArray(issue?.subscriberIds)
      ? issue.subscriberIds
      : [];
  watcherIds.forEach(userId => addRole(userId, 'subscriber'));

  return [...participants.values()];
}
