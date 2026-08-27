function memberId(member) {
  const value = member?.id || member?.uid;
  return typeof value === 'string' && value ? value : null;
}

function defaultMemberRate(member, positions) {
  const profileRate = Number(member?.hourlyRate);
  if (Number.isFinite(profileRate) && profileRate > 0) return profileRate;

  const position = member?.positionId
    ? positions.find(candidate => candidate.id === member.positionId)
    : null;
  const positionRate = Number(position?.hourlyRate);
  return Number.isFinite(positionRate) && positionRate > 0 ? positionRate : 0;
}

export function emptyBillingMemberState(projectKey = '') {
  return {
    projectKey,
    rates: {},
    presets: {},
    touchedRateIds: [],
    touchedPresetIds: [],
  };
}

export function reconcileBillingMemberState({
  state,
  projectKey,
  members = [],
  positions = [],
}) {
  const sameProject = state?.projectKey === projectKey;
  const current = sameProject ? state : emptyBillingMemberState(projectKey);
  const touchedRateIds = new Set(current.touchedRateIds || []);
  const touchedPresetIds = new Set(current.touchedPresetIds || []);
  const rates = { ...(current.rates || {}) };
  const presets = { ...(current.presets || {}) };

  members.forEach(member => {
    const uid = memberId(member);
    if (!uid) return;

    if (!touchedRateIds.has(uid)) {
      rates[uid] = defaultMemberRate(member, positions);
    }
    if (!touchedPresetIds.has(uid)) {
      if (member.positionId) presets[uid] = member.positionId;
      else delete presets[uid];
    }
  });

  return {
    projectKey,
    rates,
    presets,
    touchedRateIds: [...touchedRateIds],
    touchedPresetIds: [...touchedPresetIds],
  };
}

export function setBillingMemberRate(state, {
  projectKey,
  uid,
  rate,
}) {
  const current = state?.projectKey === projectKey
    ? state
    : emptyBillingMemberState(projectKey);
  return {
    ...current,
    rates: { ...current.rates, [uid]: rate },
    touchedRateIds: [...new Set([...(current.touchedRateIds || []), uid])],
  };
}

export function setBillingMemberPreset(state, {
  projectKey,
  uid,
  presetId,
}) {
  const current = state?.projectKey === projectKey
    ? state
    : emptyBillingMemberState(projectKey);
  return {
    ...current,
    presets: { ...current.presets, [uid]: presetId },
    touchedPresetIds: [...new Set([...(current.touchedPresetIds || []), uid])],
  };
}

// Re-denominates every rate already entered for this project. Changing an
// invoice's currency used to leave the numbers untouched, so "120" silently
// stopped meaning $120 and started meaning ₴120; converting is the only way the
// figures keep their value across the switch.
export function convertBillingMemberRates(state, { projectKey, factor }) {
  const current = state?.projectKey === projectKey
    ? state
    : emptyBillingMemberState(projectKey);
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return current;
  const rates = {};
  const touchedRateIds = new Set(current.touchedRateIds || []);
  for (const [uid, rate] of Object.entries(current.rates || {})) {
    const value = Number(rate);
    if (!Number.isFinite(value) || value === 0) {
      rates[uid] = rate;
      continue;
    }
    rates[uid] = Math.round(value * factor * 100) / 100;
    touchedRateIds.add(uid);
  }
  return {
    ...current,
    rates,
    touchedRateIds: [...touchedRateIds],
  };
}
