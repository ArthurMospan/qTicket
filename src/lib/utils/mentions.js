/**
 * Parse @mentions from text
 * Format: @username or @uid
 * Returns array of mentioned identifiers (names or UIDs)
 */
export function parseMentions(text) {
  if (!text) return [];
  const regex = /@(\w+)/g;
  const matches = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.push(match[1]);
  }
  return [...new Set(matches)]; // deduplicate
}

/**
 * Find user IDs from mentions
 * members: array of {id, uid, name, email, ...}
 * mentions: array of ["username", "email", ...]
 */
export function resolveUserIds(mentions, members) {
  const userIds = [];

  mentions.forEach(mention => {
    const lowerMention = mention.toLowerCase();

    // Try to find by name
    let user = members.find(m => (m.name || '').toLowerCase() === lowerMention);
    if (user) {
      userIds.push(user.id || user.uid);
      return;
    }

    // Try to find by email
    user = members.find(m => (m.email || '').toLowerCase() === lowerMention);
    if (user) {
      userIds.push(user.id || user.uid);
      return;
    }

    // Try to find by first word of name
    user = members.find(m => {
      const firstName = (m.name || '').split(' ')[0].toLowerCase();
      return firstName === lowerMention;
    });
    if (user) {
      userIds.push(user.id || user.uid);
      return;
    }
  });

  return [...new Set(userIds)]; // deduplicate
}

/**
 * Format mention in comment text for display
 * Replaces @username with highlighted mention
 */
export function formatMentions(text) {
  if (!text) return text;
  return text.replace(/@(\w+)/g, '<strong>@$1</strong>');
}

/**
 * Resolve mentions produced by the member picker. Unlike the legacy
 * `parseMentions`, this intentionally supports display names with spaces.
 */
export function extractMentionedUserIds(text, members = [], currentUserId = '') {
  if (!text) return [];
  return [...new Set(members
    .filter(member => {
      if (!member?.name) return false;
      const escapedName = member.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`@${escapedName}(?=\\s|[.,!?;:]|$)`).test(text);
    })
    .map(member => member.id || member.uid)
    .filter(userId => userId && userId !== currentUserId))];
}

export function filterMentionCandidates(members = [], currentUserId = '', query = '') {
  const normalizedQuery = query.trim().toLocaleLowerCase('uk-UA');
  return members.filter(member => {
    const memberId = member?.id || member?.uid;
    if (!member?.name || !memberId || memberId === currentUserId) return false;
    return member.name.toLocaleLowerCase('uk-UA').includes(normalizedQuery);
  });
}
