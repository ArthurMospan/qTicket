export const LEGACY_EPIC_TYPE_ID = 'epic';

export function creatableIssueTypeIds(configuredTypeIds = []) {
  return [...new Set(
    (Array.isArray(configuredTypeIds) ? configuredTypeIds : [])
      .filter(typeId => (
        typeof typeId === 'string'
        && typeId.trim()
        && typeId !== LEGACY_EPIC_TYPE_ID
      )),
  )];
}

export function resolveNewIssueType(requestedType, configuredTypeIds = []) {
  if (requestedType === LEGACY_EPIC_TYPE_ID) {
    return {
      type: null,
      error: {
        code: 'LEGACY_EPIC_TYPE',
        status: 400,
        message: 'Епік є лише legacy-типом і недоступний для нових завдань',
      },
    };
  }
  const ids = creatableIssueTypeIds(configuredTypeIds);
  if (ids.length === 0) {
    return {
      type: null,
      error: {
        code: 'NO_CREATABLE_ISSUE_TYPE',
        status: 409,
        message: 'У процесі немає активного типу для нових завдань',
      },
    };
  }
  return {
    type: ids.includes(requestedType)
      ? requestedType
      : (ids.includes('task') ? 'task' : ids[0]),
    error: null,
  };
}
