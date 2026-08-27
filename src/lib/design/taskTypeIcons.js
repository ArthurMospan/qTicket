import {
  Bug,
  Sparkles,
  Star,
  Zap,
} from 'lucide-react';
import { TaskIcon } from '@/lib/design/icons';
import { taskTypeIconKeyForType } from '@/lib/utils/taskTypes.mjs';

// Firestore stores the string key, never the React component. Every task-type
// surface resolves that key through this one map, so a custom type looks the
// same in selectors, cards, search and billing.
export const TASK_TYPE_ICONS = Object.freeze({
  task: TaskIcon,
  feature: Sparkles,
  sparkles: Sparkles,
  bug: Bug,
  star: Star,
  epic: Zap,
});

export function taskTypeIconKey(type) {
  return taskTypeIconKeyForType(type);
}

export function taskTypeIcon(type) {
  return TASK_TYPE_ICONS[taskTypeIconKey(type)] || Star;
}

export function taskTypeSelectOption(type) {
  return {
    value: type.id,
    label: type.label,
    icon: taskTypeIcon(type),
  };
}
