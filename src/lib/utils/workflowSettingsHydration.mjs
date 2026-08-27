import { localizeBuiltInWorkflowItems } from './workflowDefaults.mjs';
import { withStatusCategories } from './statusCategories.mjs';
import { ensureSystemPriorities } from './priorities.mjs';
import { ensureSystemTaskType } from './taskTypes.mjs';

export const WORKFLOW_SETTINGS_SECTIONS = Object.freeze([
  'statuses',
  'types',
  'priorities',
  'labels',
  'positions',
]);

// Settings keeps the workflow sections in separate React state values for the
// editors. Always resolve one complete payload before applying those setters:
// a missing/legacy field must come from this organization's defaults, never
// from whichever organization happened to be open previously.
export function hydrateWorkflowSettings(storedWorkflow, defaults) {
  const stored = storedWorkflow && typeof storedWorkflow === 'object'
    ? storedWorkflow
    : {};

  return Object.fromEntries(WORKFLOW_SETTINGS_SECTIONS.map(section => {
    const source = Array.isArray(stored[section])
      ? stored[section]
      : defaults?.[section];
    const items = Array.isArray(source) ? source : [];
    const localized = localizeBuiltInWorkflowItems(section, items);
    // A workflow saved before categories existed carries none, and the editor
    // must not show an empty control for a status whose category the rest of the
    // app already knows. Resolving it here also makes the loaded state the
    // autosave baseline, so opening Settings never writes on its own.
    const resolved = section === 'statuses'
      ? withStatusCategories(localized)
      : section === 'priorities'
        ? ensureSystemPriorities(localized)
        : section === 'types'
          ? ensureSystemTaskType(localized)
          : localized;

    // Give each organization its own in-memory objects as well as arrays.
    return [section, resolved.map(item => ({ ...item }))];
  }));
}
