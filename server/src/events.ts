import { EventEmitter } from "node:events";

/** In-process bus. The SSE endpoint relays these to browsers. */
export const bus = new EventEmitter();
bus.setMaxListeners(100);

export type BusEvent =
  | { type: "message"; groupId: number; message: unknown }
  | { type: "state"; groupId: number }
  | { type: "typing"; groupId: number; typing: boolean };

export function emit(event: BusEvent): void {
  bus.emit("event", event);
}
