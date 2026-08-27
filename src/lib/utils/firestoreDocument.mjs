// A Firestore document's path is its identity. Some legacy records also carry
// an `id` field in their data, but that denormalized copy may be stale (and the
// browser SDK may keep that stale value in IndexedDB). Always apply the path id
// after the stored data so cache contents can never redirect one resource to
// another.
export function firestoreDocumentData(document, options) {
  return {
    ...document.data(options),
    id: document.id,
  };
}

/**
 * The same, read the way a live listener has to read it.
 *
 * `serverTimestamps: 'estimate'` is an option of `data()` and of nothing else.
 * Nine hooks passed it as the options argument of `onSnapshot`, which accepts
 * `includeMetadataChanges` there and silently ignores everything else — so a
 * document the browser had just written came back with `null` where its
 * timestamp belongs, right up until the server acknowledged the write.
 *
 * That is the blank time under a message that has only just been sent, the
 * audit line with no date, and the new sprint that sorts to the wrong end of
 * the list and then quietly moves. The same mistake in nine places is a missing
 * function, so this is the function: a listener maps its documents through here
 * and cannot put the option in the wrong place.
 */
export function liveDocumentData(document) {
  return firestoreDocumentData(document, { serverTimestamps: 'estimate' });
}
