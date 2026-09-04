/**
 * The shared-memory protocol behind the studio's genuinely blocking `input` read (#876) — the one
 * place that owns how a suspended interpreter and the browser's main thread hand a single answer
 * (or a cancellation) across a thread boundary.
 *
 * ## Why a protocol module at all
 * `spec/interaction-events.md:160-163` makes `input` the only blocking read in v0.1, and
 * `@openlogo/runtime`'s reader (`ExecuteOptions.hostInput.read`) is synchronous **because** that is
 * the guarantee by construction. A browser's main thread cannot block for a styled, keyboard-
 * operable prompt, so #876 moves the interpreter into a Worker and blocks *there*: the Worker parks
 * on `Atomics.wait` until the main thread writes the learner's answer into shared memory and wakes
 * it. That is the only mechanism in the platform that suspends a synchronous call without changing
 * the runtime's semantics — see `docs/adr/0023-worker-execution-host.md`.
 *
 * ## Why this module is pure, and why `wait`/`notify` are injected
 * `Atomics.wait` is unavailable on a browser's main thread and its scheduling is inherently
 * timing-dependent, which is exactly the class of code that cannot be covered portably (issue
 * #897). So every decision lives here as straight-line logic over an `Int32Array`/`Uint16Array`,
 * with {@link BlockingInputWait} and {@link BlockingInputNotify} supplied by the caller: the real
 * `Atomics.wait`/`Atomics.notify` in `web/execution-worker.ts` and `web/main.ts`, and a
 * deterministic fake in this module's tests. Nothing here references a browser global, matching
 * `web-bootstrap.ts`'s injected-`TimeoutSchedulerTimers` pattern.
 *
 * ## Layout
 * One buffer carries both directions:
 * - an `Int32Array` control block of {@link BLOCKING_INPUT_CONTROL_SLOT_COUNT} slots — the read
 *   state, the answer's length, and the run-wide cancellation flag;
 * - a `Uint16Array` answer region holding the answer's **UTF-16 code units** verbatim.
 *
 * Storing code units rather than UTF-8 bytes is deliberate: it needs no `TextEncoder`/`TextDecoder`
 * (neither is declared under this monorepo's `lib: ["es2023"]`, so using them would mean injecting a
 * codec seam for no benefit), it round-trips surrogate pairs unchanged because a lone code unit is
 * copied as-is, and it makes "does the answer fit" a plain `length` comparison the caller can act on
 * rather than an encoding-dependent surprise.
 *
 * ## The bound
 * A blocked read is **never an indefinite park**. {@link awaitBlockingRead} waits with a timeout and
 * re-checks the state, so it observes a cancellation within one poll interval even if the wake-up
 * were missed entirely — the wait cannot outlive a Stop. The *total* time a learner is given to
 * answer is deliberately unbounded, since that is what a blocking question means; what is bounded is
 * how long it takes a cancellation to be noticed. This is the bound that replaces the no-progress
 * retry cap #881 deleted, and it fits the mechanism: the cap counted *attempts within a replay
 * chain*, whereas a Worker host has no replay to count (see `execution-host.ts`).
 */

import type { CancellationSignal } from "@openlogo/runtime";

/**
 * How many `Int32` slots the control block occupies: the read state, the answer's length in UTF-16
 * code units, and the run-wide cancellation flag.
 */
export const BLOCKING_INPUT_CONTROL_SLOT_COUNT = 3;

/** The control slot holding one of the `STATE_*` values below. */
const STATE_INDEX = 0;
/** The control slot holding the pending answer's length, in UTF-16 code units. */
const ANSWER_LENGTH_INDEX = 1;
/** The control slot holding the run-wide cancellation flag (`0` armed, `1` cancelled). */
const CANCELLED_INDEX = 2;

/** No read is outstanding: the interpreter is running, not waiting. */
const STATE_IDLE = 0;
/** A read is outstanding and the interpreter is (or is about to be) parked on it. */
const STATE_WAITING = 1;
/** The main thread has written an answer into the answer region. */
const STATE_ANSWERED = 2;
/** The read was ended without an answer — dismissed by the learner, or cancelled by Stop/Reset. */
const STATE_DISMISSED = 3;

/** The answer region's default size, in UTF-16 code units (16 KiB of shared memory). */
export const DEFAULT_BLOCKING_INPUT_ANSWER_CAPACITY = 8192;

/**
 * How long a single {@link awaitBlockingRead} wait parks before re-checking the control block. It
 * bounds how long a blocked read can survive a Stop whose wake-up never arrived — see this module's
 * doc comment ("The bound"). Short enough to feel immediate, long enough that the Worker is
 * genuinely parked rather than spinning.
 */
export const DEFAULT_BLOCKING_INPUT_POLL_INTERVAL_MS = 50;

/** The two typed views over one shared buffer — created on both threads over the *same* memory. */
export interface BlockingInputChannel {
  /** The control block: read state, answer length, cancellation flag. */
  readonly control: Int32Array;
  /** The answer region, as UTF-16 code units. */
  readonly answer: Uint16Array;
}

/**
 * `Atomics.wait`'s exact signature, injected so this module stays free of a primitive that throws
 * on a browser's main thread and cannot be covered deterministically.
 */
export type BlockingInputWait = (
  control: Int32Array,
  index: number,
  expected: number,
  timeoutMs: number,
) => "ok" | "not-equal" | "timed-out";

/** `Atomics.notify`'s exact signature, injected for the same reason as {@link BlockingInputWait}. */
export type BlockingInputNotify = (
  control: Int32Array,
  index: number,
) => number;

/** Allocates the channel's backing memory — `(byteLength) => new SharedArrayBuffer(byteLength)`. */
export type BlockingInputBufferAllocator = (
  byteLength: number,
) => ArrayBufferLike;

/** How a blocked read ended, from the waiting interpreter's side. */
export type BlockingReadOutcome =
  | {
      /** The learner answered. */
      readonly kind: "answered";
      /** Their answer, exactly as it was written. */
      readonly answer: string;
    }
  | {
      /**
       * The read ended without an answer — the learner dismissed the question, or Stop/Reset
       * cancelled the run. Both map onto the runtime reader's own `undefined`
       * (`spec/interaction-events.md:162-163`), so they need not be distinguished here.
       */
      readonly kind: "dismissed";
    };

/** Whether {@link deliverBlockingAnswer} could fit the answer into the channel's answer region. */
export interface BlockingAnswerDelivery {
  /** `true` when the answer was written and the waiting interpreter was woken. */
  readonly delivered: boolean;
  /** The answer's length in UTF-16 code units — compare against the channel's own capacity. */
  readonly requiredCapacity: number;
}

/** The byte length a buffer needs to carry a control block plus `answerCapacity` code units. */
export function blockingInputBufferByteLength(
  answerCapacity: number = DEFAULT_BLOCKING_INPUT_ANSWER_CAPACITY,
): number {
  return (
    BLOCKING_INPUT_CONTROL_SLOT_COUNT * Int32Array.BYTES_PER_ELEMENT +
    answerCapacity * Uint16Array.BYTES_PER_ELEMENT
  );
}

/**
 * Build the two views over `buffer`. Both threads call this over the **same** buffer — the Worker
 * receives it through the run command, so neither side allocates memory the other cannot see. The
 * answer region takes whatever space is left after the control block, so a caller sizes the channel
 * purely by choosing the buffer.
 */
export function createBlockingInputChannel(
  buffer: ArrayBufferLike,
): BlockingInputChannel {
  const controlByteLength =
    BLOCKING_INPUT_CONTROL_SLOT_COUNT * Int32Array.BYTES_PER_ELEMENT;
  return {
    control: new Int32Array(buffer, 0, BLOCKING_INPUT_CONTROL_SLOT_COUNT),
    answer: new Uint16Array(
      buffer,
      controlByteLength,
      (buffer.byteLength - controlByteLength) / Uint16Array.BYTES_PER_ELEMENT,
    ),
  };
}

/**
 * Arm a read, from the interpreter's side — **before** the prompt is posted to the main thread.
 * Doing it in that order is what makes an answer that arrives "too early" harmless: the main thread
 * can only observe a prompt that is already waiting, so a delivery can never be overwritten by an
 * arm that runs after it.
 */
export function armBlockingRead(channel: BlockingInputChannel): void {
  Atomics.store(channel.control, ANSWER_LENGTH_INDEX, 0);
  Atomics.store(channel.control, STATE_INDEX, STATE_WAITING);
}

/**
 * Park the interpreter until the read ends, then report how. Waits in bounded slices rather than
 * indefinitely (see this module's doc comment, "The bound"), and re-reads the control block on every
 * pass so a cancellation is observed even if its wake-up were missed entirely.
 *
 * `wait`'s own return value is deliberately ignored: `"ok"`, `"not-equal"` and `"timed-out"` all
 * mean the same thing here — go around and read the authoritative state — so branching on it would
 * add three untestable paths that decide nothing.
 */
export function awaitBlockingRead(
  channel: BlockingInputChannel,
  wait: BlockingInputWait,
  pollIntervalMs: number = DEFAULT_BLOCKING_INPUT_POLL_INTERVAL_MS,
): BlockingReadOutcome {
  for (;;) {
    if (isBlockingCancellationRequested(channel)) {
      return { kind: "dismissed" };
    }
    const state = Atomics.load(channel.control, STATE_INDEX);
    if (state === STATE_ANSWERED) {
      return { kind: "answered", answer: readBlockingAnswer(channel) };
    }
    if (state !== STATE_WAITING) {
      return { kind: "dismissed" };
    }
    wait(channel.control, STATE_INDEX, STATE_WAITING, pollIntervalMs);
  }
}

/** Read the answer region back out as a string, using the length the writer recorded. */
function readBlockingAnswer(channel: BlockingInputChannel): string {
  const length = Atomics.load(channel.control, ANSWER_LENGTH_INDEX);
  let text = "";
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(Atomics.load(channel.answer, index));
  }
  return text;
}

/**
 * Write the learner's answer and wake the waiting interpreter, from the main thread's side.
 *
 * An answer longer than the channel's answer region is **refused rather than truncated**: silently
 * dropping the tail would hand the program a value the learner did not type, which is worse than
 * making the caller decide. The read stays outstanding, so the caller can widen the channel or ask
 * again — see {@link BlockingAnswerDelivery}.
 */
export function deliverBlockingAnswer(
  channel: BlockingInputChannel,
  answer: string,
  notify: BlockingInputNotify,
): BlockingAnswerDelivery {
  if (answer.length > channel.answer.length) {
    return { delivered: false, requiredCapacity: answer.length };
  }
  for (let index = 0; index < answer.length; index += 1) {
    Atomics.store(channel.answer, index, answer.charCodeAt(index));
  }
  Atomics.store(channel.control, ANSWER_LENGTH_INDEX, answer.length);
  Atomics.store(channel.control, STATE_INDEX, STATE_ANSWERED);
  notify(channel.control, STATE_INDEX);
  return { delivered: true, requiredCapacity: answer.length };
}

/**
 * End the outstanding read without an answer — the learner dismissed the question. The waiting
 * interpreter's `read` returns `undefined`, which cancels the program exactly as
 * `spec/interaction-events.md:162-163` describes.
 */
export function dismissBlockingRead(
  channel: BlockingInputChannel,
  notify: BlockingInputNotify,
): void {
  Atomics.store(channel.control, STATE_INDEX, STATE_DISMISSED);
  notify(channel.control, STATE_INDEX);
}

/**
 * Request cancellation of the whole run (Stop/Reset). Sets the run-wide flag
 * {@link createSharedCancellationSignal} exposes to the interpreter *and* ends any outstanding read,
 * so a program is preempted whether it is computing or blocked on a question — the second want
 * issue #876 names, and the one a same-thread studio could never offer.
 */
export function requestBlockingCancellation(
  channel: BlockingInputChannel,
  notify: BlockingInputNotify,
): void {
  Atomics.store(channel.control, CANCELLED_INDEX, 1);
  dismissBlockingRead(channel, notify);
}

/** Whether Stop/Reset has requested cancellation of this run. */
export function isBlockingCancellationRequested(
  channel: BlockingInputChannel,
): boolean {
  return Atomics.load(channel.control, CANCELLED_INDEX) === 1;
}

/**
 * A `CancellationSignal` backed by shared memory — the preemptible Stop. `@openlogo/runtime` reads
 * `aborted` before every statement and loop pass, so a flag another thread sets takes effect *mid*
 * `execute()`, which a same-thread caller could never achieve (`run-controller.ts`'s own doc comment
 * has recorded that limitation since #126).
 */
export function createSharedCancellationSignal(
  channel: BlockingInputChannel,
): CancellationSignal {
  return {
    get aborted(): boolean {
      return isBlockingCancellationRequested(channel);
    },
  };
}

/** Whether a read is currently outstanding — used to keep the Worker protocol honest. */
export function isBlockingReadOutstanding(
  channel: BlockingInputChannel,
): boolean {
  return Atomics.load(channel.control, STATE_INDEX) === STATE_WAITING;
}

/** Clear the read state back to idle once the interpreter has consumed an outcome. */
export function clearBlockingRead(channel: BlockingInputChannel): void {
  Atomics.store(channel.control, STATE_INDEX, STATE_IDLE);
  Atomics.store(channel.control, ANSWER_LENGTH_INDEX, 0);
}
