export const INTEGRATION_STATES = Object.freeze({
  available: 'Доступно',
  planned: 'У планах',
});

export const INTEGRATIONS = Object.freeze([
  Object.freeze({ id: 'quickteam-plus', label: 'QuickTeam+', state: 'available', route: '/settings?section=integrations' }),
  Object.freeze({ id: 'telegram', label: 'Telegram', state: 'available', route: '/settings?section=integrations' }),
  Object.freeze({ id: 'buggybag', label: 'BuggyBag', state: 'available', route: '/settings?section=integrations' }),
  Object.freeze({ id: 'youtrack', label: 'YouTrack', state: 'available', route: '/settings?section=migrations' }),
  Object.freeze({ id: 'jira', label: 'Jira', state: 'planned' }),
  Object.freeze({ id: 'clickup', label: 'ClickUp', state: 'planned' }),
  Object.freeze({ id: 'asana', label: 'Asana', state: 'planned' }),
  Object.freeze({ id: 'trello', label: 'Trello', state: 'planned' }),
  Object.freeze({ id: 'linear', label: 'Linear', state: 'planned' }),
  Object.freeze({ id: 'monday', label: 'monday.com', state: 'planned' }),
]);

export const AVAILABLE_INTEGRATIONS = INTEGRATIONS.filter(item => item.state === 'available');
export const PLANNED_INTEGRATIONS = INTEGRATIONS.filter(item => item.state === 'planned');
