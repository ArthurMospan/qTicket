/**
 * Чисті хелпери етапів QuickTeam+ (Фаза 4a′). Без Firebase — `node --test`.
 *
 * УВАГА: canAccessStage — це UI-паритет із порталом (qt/src/components/StageNav.jsx),
 * а НЕ правило безпеки. Firestore віддасть матеріали todo-етапу будь-якому членові
 * команди. Замок відтворює поведінку порталу, щоб два продукти поводились однаково;
 * покладатись на нього як на захист не можна.
 */

/** Прогрес по етапах проєкту. */
export function stageProgress(stages) {
  const list = Array.isArray(stages) ? stages : [];
  const total = list.length;
  const done = list.filter((s) => s && s.status === 'done').length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

/** Підпис + тон для статусу етапу. */
export function stageStatusMeta(status) {
  if (status === 'todo') return { label: 'Заплановано', tone: 'muted' };
  if (status === 'in-progress') return { label: 'В роботі', tone: 'active' };
  if (status === 'done') return { label: 'Завершено', tone: 'done' };
  return { label: '—', tone: 'muted' };
}

/** Чи можна відкрити етап (паритет із порталом — див. шапку). */
export function canAccessStage(stage) {
  if (!stage || typeof stage !== 'object') return false;
  return stage.status === 'done' || stage.status === 'in-progress';
}

/**
 * Етап, відкритий за замовчуванням:
 * 1) перший in-progress; 2) інакше останній done; 3) інакше null (усі todo).
 */
export function defaultStageId(stages) {
  const list = Array.isArray(stages) ? stages : [];
  const active = list.find((s) => s && s.status === 'in-progress');
  if (active) return active.id;
  const done = list.filter((s) => s && s.status === 'done');
  if (done.length) return done[done.length - 1].id;
  return null;
}
