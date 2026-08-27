// Which sections of a list are open, for lists whose sections do not all start
// the same way. The sprints page is the one: a running sprint opens by default
// and a finished one stays folded, so "open" cannot be read from the map alone.
//
// The map therefore only ever holds a decision the user has made, and the
// toggle is told what is currently on screen rather than guessing it. Without
// that argument the first click on a section that defaults to closed wrote
// `false` into an empty slot — the state it was already in — and the header
// only answered the second click.

/**
 * The expansion map after the user clicks a section header.
 *
 * @param {Record<string, boolean>} current The sections the user has already decided on.
 * @param {string} sectionId The section that was clicked.
 * @param {boolean} isExpanded Whether that section is open right now, defaults included.
 * @returns {Record<string, boolean>} The next map, with the clicked section flipped.
 */
export function nextSectionExpansion(current, sectionId, isExpanded) {
  return { ...current, [sectionId]: !isExpanded };
}
