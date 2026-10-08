import type { EventType } from "./types.ts";

export type EventHandler = (event: {
  id: string;
  type: string;
  aggregateId: string;
  payload: unknown;
}) => Promise<void>;

// Spec §11.1 consumers register here by event type. Empty this round: a type
// with no handler is simply marked processed.
export const handlers: Partial<Record<EventType, EventHandler>> = {};
