/**
 * The Worker side of the blocking execution host (#876) — the code that actually runs
 * `@openlogo/runtime`'s `execute()` off the main thread and **parks inside the `input` reader**
 * until the learner answers.
 *
 * This is where `spec/interaction-events.md:154-157` is finally honoured without reconciliation:
 * the reader is synchronous, so no OpenLogo instruction and no handler block runs until the read
 * finishes — and the wait is a genuine `Atomics.wait`, not a cancellation the studio replays past.
 *
 * ## Why it lives in `src/` rather than in the Worker entry
 * `web/**` is outside this package's `src` build graph and is never imported by a test, so all
 * logic must live here behind injected seams — the same rule `web-bootstrap.ts` follows. The real
 * entry (`web/execution-worker.ts`) supplies `Atomics.wait` and `self.postMessage` and does nothing
 * else, so everything decided here is inside the 100% coverage gate with no timing dependence.
 *
 * ## The two things that make a blank canvas impossible
 * The reader is called with the prompt and **nothing else**, so a Worker parked in it would have no
 * way to tell the main thread what the program has already drawn — the learner would be asked a
 * question over an empty canvas, a straight regression against #769, which draws the square and
 * *then* asks. Two seams prevent that:
 * - `ExecuteOptions.observedEvents` (#876, `@openlogo/runtime`) is a caller-supplied array the run
 *   appends to live, so the prefix is readable from inside the reader at all;
 * - the read report carries that prefix **already reduced** to `output`/`tutorOutput`, because
 *   structured clone drops class prototypes and `printedForm` throws on a cloned `OLDict` — see
 *   `execution-host.ts`'s doc comment.
 *
 * `spec/interaction-events.md:154-156` explicitly permits this ("the implementation **MAY** continue
 * rendering already-emitted trace events"), and before the `observedEvents` seam that allowance was
 * unreachable.
 *
 * ## Why a read is answered from the FIFO before it is put to the learner (#976)
 * Parking is the *second* thing this reader tries, not the first. Until #976 a chain that had asked
 * a question refused host input for the rest of its life, so this host never re-ran a program past a
 * read and could always park. #976 deletes that refusal — `:154-157` blocks handlers only "until the
 * read finishes" — so a key press now replays the chain, and a reader that always parked would
 * **re-ask every question the learner had already answered**, one modal per press.
 *
 * `ExecutionRequest.answers` is the chain's own accumulated answers, and `resolveRecordedAnswer`
 * pairs each to the question it was given for, so an answer can never reach a question the learner
 * was not shown. A read the FIFO has no answer for still parks, exactly as before.
 */

import { execute } from "@openlogo/runtime";
import type { TickBoundary } from "@openlogo/runtime";
import type { TraceEvent } from "@openlogo/core";
import {
  armBlockingRead,
  awaitBlockingRead,
  clearBlockingRead,
  createBlockingInputChannel,
  createSharedCancellationSignal,
} from "./blocking-input-channel.js";
import type { BlockingInputWait } from "./blocking-input-channel.js";
import {
  collectOutput,
  collectTutorOutput,
  resolveRecordedAnswer,
  toExecuteOptions,
} from "./execution-host.js";
import type {
  ExecutionWorkerReport,
  ExecutionWorkerRunCommand,
} from "./worker-execution-host.js";

/** The primitives the real Worker entry supplies to {@link runExecutionWorkerCommand}. */
export interface ExecutionWorkerRunnerOptions {
  /** `Atomics.wait` — injected because it throws on a main thread and cannot be covered portably. */
  readonly wait: BlockingInputWait;
  /** Posts a report back to the main thread (`self.postMessage` in the real entry). */
  readonly post: (report: ExecutionWorkerReport) => void;
  /** Overrides how long a single wait parks before re-checking for cancellation. */
  readonly pollIntervalMs?: number;
}

/**
 * Run one program to completion, blocking inside every `input` read until the main thread answers
 * it, and report the result.
 *
 * Exactly **one** `execute()` call happens per command, however many questions the program asks —
 * that is the whole point of #876, and it is why a Worker host needs no cap on replay attempts: it
 * has no attempts to cap (`execution-host.ts`, "Where the bound lives").
 */
export function runExecutionWorkerCommand(
  command: ExecutionWorkerRunCommand,
  options: ExecutionWorkerRunnerOptions,
): void {
  const channel = createBlockingInputChannel(command.buffer);
  // The live sink (#876's `ExecuteOptions.observedEvents`): the run appends to it as it goes, so the
  // reader below can report what has already been drawn while it waits.
  const observedEvents: TraceEvent[] = [];
  // #985 — the tick-timeline sink. Composed HERE as well as in the in-process host, because
  // `toExecuteOptions` cannot allocate it for a caller that must also report it back. Omitting it
  // was measured to collapse every Worker delivery onto tick 0, which is strictly worse than the
  // pre-#985 counter it was meant to replace.
  const tickTimeline: TickBoundary[] = [];
  // #976 — one cursor per run over the chain's accumulated answers, exactly as the in-process host
  // keeps. A read is answered from the FIFO only when the entry at this position was given for this
  // same question; anything else parks.
  let answerCursor = 0;
  let retainedAnswers = command.request.answers;

  const read = command.request.acceptsReads
    ? (prompt: string): string | undefined => {
        const resolution = resolveRecordedAnswer(
          retainedAnswers,
          answerCursor,
          prompt,
        );
        retainedAnswers = resolution.retained;
        if (resolution.answer !== undefined) {
          answerCursor += 1;
          return resolution.answer;
        }
        // Arm BEFORE reporting: the main thread can only see a prompt that is already waiting, so
        // an answer can never be overwritten by an arm that runs after it.
        armBlockingRead(channel);
        const prefix = observedEvents.slice();
        options.post({
          type: "read",
          runId: command.runId,
          prompt,
          events: prefix,
          output: collectOutput(prefix),
          tutorOutput: collectTutorOutput(prefix),
          tickTimeline: tickTimeline.slice(),
          // The truncated list, not the request's own: `resolveRecordedAnswer` drops every entry
          // from this position on when the replay reached a different question here, and the host
          // must adopt that or it will restore the stale entry and re-ask this question forever.
          retainedAnswers,
        });
        const outcome =
          options.pollIntervalMs === undefined
            ? awaitBlockingRead(channel, options.wait)
            : awaitBlockingRead(channel, options.wait, options.pollIntervalMs);
        clearBlockingRead(channel);
        return outcome.kind === "answered" ? outcome.answer : undefined;
      }
    : undefined;

  const result = execute(command.request.source, command.request.document, {
    ...toExecuteOptions(
      command.request,
      createSharedCancellationSignal(channel),
      read,
      tickTimeline,
    ),
    observedEvents,
  });

  options.post({
    type: "done",
    runId: command.runId,
    events: result.events.slice(),
    output: collectOutput(result.events),
    tutorOutput: collectTutorOutput(result.events),
    diagnostics: result.diagnostics,
    tickTimeline: tickTimeline.slice(),
    retainedAnswers,
  });
}
