function cleanId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function isBilledTimeLog(timeLog) {
  return Boolean(
    cleanId(timeLog?.invoiceId)
    || timeLog?.billedAt,
  );
}

export function billedTimeLogDetails(timeLogs = []) {
  const billed = (Array.isArray(timeLogs) ? timeLogs : [])
    .filter(isBilledTimeLog);
  return {
    billedTimeLogIds: billed
      .map(timeLog => cleanId(timeLog.id))
      .filter(Boolean),
    invoiceIds: [...new Set(
      billed.map(timeLog => cleanId(timeLog.invoiceId)).filter(Boolean),
    )].sort(),
  };
}
