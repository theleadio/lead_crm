import { db } from "../sql.ts";
import {
  EVENT_AGGREGATE,
  type EventPayloads,
  type EventType,
} from "./types.ts";

// Spec §11.1: writes one event_outbox row through db(), so inside a
// withTransaction it commits or rolls back with the caller's change.
export async function raiseEvent<T extends EventType>(
  type: T,
  aggregateId: string,
  payload: EventPayloads[T],
  actorId: string | null,
): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload, created_by)
    VALUES (${type}, ${EVENT_AGGREGATE[type]}, ${aggregateId},
            ${sql.json(payload as never)}, ${actorId})`;
}
