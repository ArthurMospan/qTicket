// Above this size a single Kanban column renders only the viewport-sized DOM
// window. Every task remains part of the scroll range and drag model; this is
// virtualization, not pagination and never needs a “show more” control.
export const COLUMN_VIRTUALIZATION_THRESHOLD = 40;
