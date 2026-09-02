import { isCustomerVisibleAuditEntry } from '../utils/issueAuditEvents.mjs';

/**
 * One line of a task's history, written to both feeds it belongs in.
 *
 * A task has two history collections and exactly one reason for it: Firestore
 * rules cannot require a `where` clause, so «the audit, but only the rows a
 * customer may read» is not a condition that can be written. What a client may
 * read is therefore decided by what the server puts into `statusHistory/`, and
 * for a long time it put in two actions — «створено» and «статус змінено» —
 * from two of the twelve places that write history at all. The other ten wrote
 * to `audit/` alone, so a deadline moved, a priority was raised and an agent
 * was assigned in a thread the customer was watching, and their copy of that
 * thread said nothing.
 *
 * Every writer goes through here now, so the decision about who may read a line
 * is made once, next to the line, by `isCustomerVisibleAuditEntry` — rather
 * than by whether the author of a particular route remembered there were two
 * collections. Adding a thirteenth writer means calling this; forgetting the
 * mirror is no longer something a route can do on its own.
 *
 * The mirrored document is the audit entry itself, actor included. It used to
 * be written without one, on the reasoning that which agent moved a request is
 * routing the customer is not shown — but the customer is already shown the
 * support team on their project, by name, on the project screen, and a change
 * history with no author is a list of things that happened to nobody. The
 * request is a conversation between two named sides; both sides sign it.
 *
 * @param {FirebaseFirestore.Transaction|FirebaseFirestore.WriteBatch} writer The transaction or batch already in flight.
 * @param {FirebaseFirestore.DocumentReference} issueRef The task.
 * @param {object} entry The audit entry — `action`, the actor, and whatever the action carries.
 */
export function recordIssueHistory(writer, issueRef, entry) {
  writer.create(issueRef.collection('audit').doc(), entry);
  if (!isCustomerVisibleAuditEntry(entry)) return;
  writer.create(issueRef.collection('statusHistory').doc(), entry);
}
