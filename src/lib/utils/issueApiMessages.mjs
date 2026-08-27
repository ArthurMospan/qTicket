const AUTHORIZATION_MESSAGES = Object.freeze({
  Unauthorized: 'Потрібна авторизація',
  'Invalid or expired token': 'Сесія завершилася. Увійдіть знову',
  Forbidden: 'Недостатньо прав для цієї дії',
  'Organization is required': 'Не вказано організацію',
});

export function localizedIssueAuthorizationMessage(message) {
  return AUTHORIZATION_MESSAGES[message] || message || 'Недостатньо прав для цієї дії';
}
