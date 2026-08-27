import 'server-only';

import { DEFAULT_WORKFLOW_POSITIONS } from '@/lib/utils/workflowPositions.mjs';

const DEFAULT_POSITION_RATES = Object.freeze({
  dev: 30,
  designer: 35,
  pm: 40,
  qa: 25,
});

function normalizedRate(value) {
  const rate = Number(value);
  return Number.isFinite(rate)
    ? Math.min(1_000_000, Math.max(0, rate))
    : 0;
}

export function publicWorkflow(workflow = {}) {
  return {
    ...workflow,
    positions: Array.isArray(workflow.positions)
      ? workflow.positions.map(({ hourlyRate, ...position }) => position)
      : workflow.positions,
  };
}

export function positionRatesFromWorkflow(workflow = {}) {
  return Object.fromEntries((Array.isArray(workflow.positions) ? workflow.positions : [])
    .filter(position => position?.id)
    .map(position => [position.id, normalizedRate(position.hourlyRate)]));
}

export function effectivePositionRates(workflow = {}, protectedRates = null) {
  const legacyRates = positionRatesFromWorkflow(workflow);
  const storedRates = protectedRates?.positionRates;
  const positions = Array.isArray(workflow.positions) && workflow.positions.length
    ? workflow.positions
    : DEFAULT_WORKFLOW_POSITIONS;
  return Object.fromEntries(positions
    .filter(position => position?.id)
    .map(position => {
      const id = position.id;
      const value = storedRates && Object.prototype.hasOwnProperty.call(storedRates, id)
        ? storedRates[id]
        : Object.prototype.hasOwnProperty.call(legacyRates, id)
          ? legacyRates[id]
          : DEFAULT_POSITION_RATES[id];
      return [id, normalizedRate(value)];
    }));
}

export function workflowWithProtectedRates(workflow = {}, protectedRates = null) {
  const safeWorkflow = publicWorkflow(workflow);
  const rates = effectivePositionRates(workflow, protectedRates);
  const positions = Array.isArray(safeWorkflow.positions) && safeWorkflow.positions.length
    ? safeWorkflow.positions
    : DEFAULT_WORKFLOW_POSITIONS;
  return {
    ...safeWorkflow,
    positions: positions.map(position => ({
      ...position,
      hourlyRate: rates[position.id] || 0,
    })),
  };
}

export function samePositionRates(left = {}, right = {}) {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}
