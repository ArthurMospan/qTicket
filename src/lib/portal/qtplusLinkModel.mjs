/**
 * Pure, dependency-free view-model helpers for the QuickTeam+ project-link tab.
 * No `server-only` and no Firebase import, so they run under plain `node --test`.
 */

const NO_NAME = 'Без назви';

function cleanName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed || NO_NAME;
}

/**
 * Normalize raw QuickTeam+ project docs into picker options: [{ id, name }],
 * name-fallback applied, de-duped by id (first wins), sorted by name
 * (Ukrainian, case-insensitive). Nullish / non-array -> [].
 */
export function toPortalProjectOptions(rawProjects) {
  if (!Array.isArray(rawProjects)) return [];
  const byId = new Map();
  for (const p of rawProjects) {
    if (!p || !p.id || byId.has(p.id)) continue;
    byId.set(p.id, { id: p.id, name: cleanName(p.name) });
  }
  return [...byId.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'uk', { sensitivity: 'base' }),
  );
}

/**
 * Derive the tab's view model from the stored link + available options.
 * `optionsLoaded` distinguishes "the linked project is not in your list" (no
 * access) from "the list has not loaded yet".
 */
export function resolveLinkView({ link, options = [], otherLinkedIds = [], optionsLoaded = false }) {
  const linkedId = link?.projectId || null;
  const linked = Boolean(linkedId);
  const otherSet = new Set(otherLinkedIds || []);
  const annotatedOptions = options.map((o) => ({ ...o, linkedElsewhere: otherSet.has(o.id) }));
  const match = linked ? options.find((o) => o.id === linkedId) : null;
  const linkedName = linked ? (link.projectName || match?.name || null) : null;
  const staleAccess = Boolean(linked && optionsLoaded && !match);
  return { linked, linkedId, linkedName, selectedId: linkedId, staleAccess, options: annotatedOptions };
}
