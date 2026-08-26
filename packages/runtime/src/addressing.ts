/**
 * The observable half of the Sprites **addressing model** (issue #766): the one place that turns a
 * change of the addressed turtle set into a trace event, plus the scope snapshot `ask`/`each` save
 * and restore.
 *
 * `spec/rendering.md:193` is normative — "Implementations with multiple turtles MUST identify the
 * active turtle or addressed turtle set" — but a consumer of the trace stream could not satisfy it,
 * because `tell`/`ask`/`each` changed the addressed set without emitting anything. Every per-turtle
 * effect event carries only the *acting* turtle's `turtle_id`, and after an `ask`/`each` block
 * restores (`spec/turtles-and-sprites.md:58`) the last such id is neither the active turtle nor the
 * addressed set. This module closes that gap by emitting one `primitive` event, carrying an
 * {@link AddressingSnapshot}, at **every** transition of the addressed set — including the
 * restoration paths that run on abnormal exits (`stop`, `return`/`output`/`op`, `throw`, and a
 * runtime diagnostic), because a missed restoration is a silent divergence between the runtime's
 * real state and what a consumer believes.
 *
 * **Why `primitive` and not a new event kind.** The registry's `kind` values are normative and
 * closed (`spec/execution-model.md:689-694`: `kind` is "One registered event kind"), the spec is
 * maintainer-owned, and the only sanctioned unregistered kinds are vendor-namespaced extensions
 * (`vendor_name.event_name`, `spec/conformance.md:311-322`) — which, being vendor-specific, must not
 * be recorded as portable behavior in a stack-neutral conformance fixture. `tell`, `ask`, and `each`
 * are C3 Sprites primitives (`spec/turtles-and-sprites.md:17`) with no more specific event kind,
 * which is exactly what `primitive`, "the generic catch-all for a primitive without a more specific
 * event" (`spec/execution-model.md:703`), exists for — the same reading under which the Interaction
 * registration *forms* emit `primitive` (`spec/interaction-events.md:105-106, 120-122`). So the
 * addressed set becomes observable with **no** new kind, no spec change, and no consumer change: an
 * addressing-unaware renderer just sees one more inert `primitive` event.
 */

import type { SourceSpan, TraceEvent, TurtleId } from "@openlogo/core";
import type { PrimitivePayload } from "@openlogo/core";
import type { TurtleAddressing } from "./evaluate.js";

/**
 * The Sprites primitives that change the addressed set (`spec/turtles-and-sprites.md`'s "Addressing
 * model"), and therefore the only {@link PrimitivePayload} `name`s that carry an addressing
 * snapshot: `tell` sets it persistently, `ask` scopes it to its block, `each` narrows it to one
 * turtle per iteration.
 */
export type AddressingPrimitiveName = "tell" | "ask" | "each";

/**
 * The part of {@link TurtleAddressing} an `ask`/`each` scope saves on entry and restores on exit:
 * the addressed set, the current turtle, and whether addressing is explicit yet (before any `tell`
 * the implicit main turtle's events carry no `turtle_id`). Not the per-turtle `states` map — a
 * scope changes *who* is addressed, never their drawing state.
 */
export interface AddressingScopeSnapshot {
  readonly ids: TurtleId[];
  readonly currentId: TurtleId;
  readonly explicit: boolean;
}

/**
 * Capture the addressing scope `ask`/`each` must restore when their block finishes, on every exit
 * path. One helper so the two forms save exactly the same three fields, and so a future field on
 * {@link TurtleAddressing} that belongs to the scope is added in one place rather than two.
 */
export function snapshotAddressing(
  addressing: TurtleAddressing,
): AddressingScopeSnapshot {
  return {
    ids: addressing.ids,
    currentId: addressing.currentId,
    explicit: addressing.explicit,
  };
}

/**
 * Emit the `primitive` event that makes the addressed turtle set observable, immediately **after**
 * `addressing` has been changed to the set the event reports (the effect-event timing rule of
 * `spec/execution-model.md:645-646`). `name` is the addressing primitive whose effect this is; the
 * payload snapshot is absolute, so a consumer folds it by assignment and never has to infer whether
 * the transition was an entry, a per-iteration narrowing, or a restore.
 *
 * The addressed ids are **copied** into the payload, per the effect-event snapshot rule
 * (`spec/execution-model.md:652-661`): a later change of the addressed set must not retroactively
 * rewrite an event already emitted.
 *
 * `current_turtle_id` is derived from the **set itself** — its first member, or `null` when the set
 * is empty — never from {@link TurtleAddressing.currentId}. That pointer is transiently re-aimed at
 * each addressed turtle in turn while one per-turtle command runs (`execute-internal.ts`'s
 * `runPerTurtleCommand`, so a `who` inside an argument reports the turtle actually running the
 * command), and an addressing form reached from that argument would otherwise publish the transient
 * pointer as if it were the addressed set's current turtle — a snapshot whose two halves contradict
 * each other and whose value goes stale the moment the command's loop moves on. Deriving from the set
 * makes the payload self-consistent by construction: it describes **addressing**, and the transient
 * per-turtle pointer is expressed where it belongs, on each effect event's own `turtle_id`. `null`
 * for the empty set keeps this implementation's own `who` fallback out of the portable contract (see
 * `AddressingSnapshot`).
 *
 * The envelope carries **no** `turtle_id`: it is "present only when the event is turtle-specific"
 * (`spec/execution-model.md:638`), and an addressing event describes a *set*, not one turtle — the
 * current turtle travels in the payload instead. `execute-internal.ts`'s per-turtle stamper keeps it
 * that way: it synthesizes the acting turtle's id only for the kinds that are safe to attribute that
 * way (`ACTING_TURTLE_STAMPABLE_KINDS`), which `primitive` is not.
 */
export function emitAddressingPrimitive(
  events: TraceEvent[],
  source_span: SourceSpan,
  name: AddressingPrimitiveName,
  addressing: TurtleAddressing,
): void {
  const addressed_turtle_ids = [...addressing.ids];
  const [current_turtle_id = null] = addressed_turtle_ids;
  events.push({
    seq: events.length,
    kind: "primitive",
    source_span,
    payload: {
      name,
      addressing: { addressed_turtle_ids, current_turtle_id },
    } satisfies PrimitivePayload,
  });
}
