// Organization-wide client queries are not readable. Firestore evaluates a read
// rule against every candidate document, so one document belonging to a project
// the signed-in user cannot open rejects the entire query — not just that row.
// Every cross-project stream therefore has to be split into chunks of project
// ids the user already has access to, and merged back on the client.

// Firestore `in` accepts at most 30 values; ten keeps query/index fan-out tame.
export const PROJECT_SCOPE_CHUNK_SIZE = 10;

export function chunkProjectIds(projectIds = [], size = PROJECT_SCOPE_CHUNK_SIZE) {
  const unique = [...new Set((projectIds || []).filter(Boolean))];
  const chunks = [];
  for (let index = 0; index < unique.length; index += size) {
    chunks.push(unique.slice(index, index + size));
  }
  return chunks;
}

export function flattenDocumentBuckets(buckets) {
  const byId = {};
  buckets.forEach(documents => {
    documents.forEach(document => {
      byId[document.id] = document;
    });
  });
  return Object.values(byId);
}
