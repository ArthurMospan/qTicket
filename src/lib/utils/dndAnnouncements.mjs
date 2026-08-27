export const UKRAINIAN_DRAG_HANDLE_USAGE_INSTRUCTIONS =
  'Щоб взяти елемент, натисніть пробіл. Переміщуйте його клавішами зі стрілками, '
  + 'натисніть пробіл, щоб покласти, або Escape, щоб скасувати.';

function readable(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}

function position(index) {
  return Number.isInteger(index) ? index + 1 : 1;
}

export function createUkrainianDndAnnouncements({
  itemLabel = () => 'Елемент',
  listLabel = () => 'Список',
} = {}) {
  const item = draggableId => readable(itemLabel(draggableId), 'Елемент');
  const list = droppableId => readable(listLabel(droppableId), 'Список');

  return {
    onDragStart(start, { announce }) {
      announce(
        `Взято «${item(start.draggableId)}». Позиція ${position(start.source.index)} `
        + `у списку «${list(start.source.droppableId)}».`,
      );
    },
    onDragUpdate(update, { announce }) {
      if (!update.destination) {
        announce(`«${item(update.draggableId)}» зараз поза списками.`);
        return;
      }
      const sourceList = list(update.source.droppableId);
      const destinationList = list(update.destination.droppableId);
      if (update.source.droppableId === update.destination.droppableId) {
        announce(
          `«${item(update.draggableId)}» переміщено на позицію ${position(update.destination.index)} `
          + `у списку «${destinationList}».`,
        );
        return;
      }
      announce(
        `«${item(update.draggableId)}» переміщено зі списку «${sourceList}» `
        + `до списку «${destinationList}», позиція ${position(update.destination.index)}.`,
      );
    },
    onDragEnd(result, { announce }) {
      if (result.reason === 'CANCEL' || !result.destination) {
        announce(`Переміщення «${item(result.draggableId)}» скасовано.`);
        return;
      }
      announce(
        `«${item(result.draggableId)}» покладено у список «${list(result.destination.droppableId)}», `
        + `позиція ${position(result.destination.index)}.`,
      );
    },
  };
}
