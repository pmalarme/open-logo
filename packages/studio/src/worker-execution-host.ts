/**
 * The main-thread half of the blocking execution host (#876): an {@link ExecutionHost} that runs
 * every program in a Worker and answers its `input` reads through shared memory, so a read is a
 * genuine suspension rather than #769's replay.
 *
 * ## What it buys, and what it does not
 * Two wants, one mechanism (issue #876):
 * - **A genuinely blocking `input`.** One `execute()` per run, however many questions — no
 *   re-execution, no N+1 cost, and the prefix the learner has already seen is literally the same
 *   array the run keeps extending.
 * - **A preemptible Stop.** `@openlogo/runtime` checks `ExecuteOptions.signal` before every
 *   statement, so a flag another thread sets aborts a loop *mid* `execute()`. A same-thread studio
 *   could never do that (`run-controller.ts`'s doc comment has recorded the limitation since #126);
 *   the instruction budget was the only thing keeping it responsive.
 *
 * It does **not** fix a correctness bug. #881 already closed the replay's divergence window by
 * pinning one `ExecuteOptions.randomSeed` per chain, so the replay is a correct continuation today.
 * This is the mechanism, not the fix.
 *
 * ## Why the replay survives
 * `SharedArrayBuffer` — and therefore `Atomics.wait` — requires COOP/COEP cross-origin isolation,
 * a deployment posture, not a code decision. `web/main.ts` feature-detects it
 * (`web-bootstrap.ts`'s {@link supportsBlockingExecutionHost}) and installs this host only when the
 * page is isolated; otherwise the in-process replay host runs, unchanged. See
 * `docs/adr/0023-worker-execution-host.md`.
 *
 * ## Everything is injected
 * The port, the buffer allocator, and `Atomics.notify` are all supplied by the caller, per this
 * package's rule that browser globals are injected and never referenced (`web-bootstrap.ts`'s
 * `TimeoutSchedulerTimers` is the model). That also keeps this module's tests free of real threads
 * and real timing, which is what the 100% coverage gate needs (issue #897).
 */

import {
  blockingInputBufferByteLength,
  createBlockingInputChannel,
  deliverBlockingAnswer,
  dismissBlockingRead,
  requestBlockingCancellation,
} from "./blocking-input-channel.js";
import type {
  BlockingInputBufferAllocator,
  BlockingInputChannel,
  BlockingInputNotify,
} from "./blocking-input-channel.js";
import type {
  ExecutionHost,
  ExecutionRequest,
  ExecutionSettle,
} from "./execution-host.js";
import type {
  Diagnostic,
  TraceEvent,
  TutorOutputPayload,
} from "@openlogo/core";

/** The single command the main thread sends: run this program, using this shared control buffer. */
export interface ExecutionWorkerRunCommand {
  readonly type: "run";
  /**
   * Identifies this run, so a report can be matched to the run that produced it. A Worker processes
   * messages serially and a cancelled run still finishes and reports, so without this tag a Stop
   * immediately followed by a Run would settle the **new** run with the **old** one's events — the
   * previous run's ending arrives after `execute()` has already installed the next run's callback.
   */
  readonly runId: number;
  /** The run to perform — plain data, so it crosses the boundary by structured clone. */
  readonly request: ExecutionRequest;
  /** The shared buffer both threads build a `BlockingInputChannel` over. */
  readonly buffer: ArrayBufferLike;
}

/** Everything the main thread can send the Worker. One command today; a union for tomorrow. */
export type ExecutionWorkerCommand = ExecutionWorkerRunCommand;

/** The run has reached an `input` and is now parked on it — here is everything drawn so far. */
export interface ExecutionWorkerReadReport {
  readonly type: "read";
  /** The run this belongs to — see {@link ExecutionWorkerRunCommand.runId}. */
  readonly runId: number;
  /** The question, already rendered to text by the runtime — studio never re-formats it. */
  readonly prompt: string;
  /** The trace events emitted before the read. */
  readonly events: readonly TraceEvent[];
  /** Those events' `print` output, reduced **in the Worker** — see `execution-host.ts`. */
  readonly output: readonly string[];
  /** Those events' `tutor-output` payloads, in order. */
  readonly tutorOutput: readonly TutorOutputPayload[];
}

/** The run finished — normally, on a diagnostic, or cancelled. */
export interface ExecutionWorkerDoneReport {
  readonly type: "done";
  /** The run this belongs to — see {@link ExecutionWorkerRunCommand.runId}. */
  readonly runId: number;
  /** The complete trace-event stream. */
  readonly events: readonly TraceEvent[];
  /** The complete `print` output, reduced in the Worker. */
  readonly output: readonly string[];
  /** The complete `tutor-output` payloads, in order. */
  readonly tutorOutput: readonly TutorOutputPayload[];
  /** The run's diagnostics, exactly as `@openlogo/runtime` produced them. */
  readonly diagnostics: readonly Diagnostic[];
}

/** Everything the Worker can send back. */
export type ExecutionWorkerReport =
  ExecutionWorkerReadReport | ExecutionWorkerDoneReport;

/**
 * The minimal Worker surface this host needs — matches a real `Worker` closely enough that
 * `web/main.ts` adapts one in two lines, while this module's tests pass a plain fake.
 */
export interface ExecutionWorkerPort {
  /** Send a command to the Worker. */
  postMessage(command: ExecutionWorkerCommand): void;
  /** Register the single listener that receives every report the Worker posts back. */
  onReport(listener: (report: ExecutionWorkerReport) => void): void;
}

/** Construction options for {@link createWorkerExecutionHost}. */
export interface WorkerExecutionHostOptions {
  /** The Worker running `execution-worker-runner.ts`. */
  readonly port: ExecutionWorkerPort;
  /** Allocates the shared control buffer — `(bytes) => new SharedArrayBuffer(bytes)` in a browser. */
  readonly allocateBuffer: BlockingInputBufferAllocator;
  /** `Atomics.notify`, injected for the same reason the wait is (`blocking-input-channel.ts`). */
  readonly notify: BlockingInputNotify;
  /**
   * The answer region's size in UTF-16 code units. An answer longer than this cannot be delivered
   * through shared memory; see {@link ExecutionHost.resolveRead} below for what happens then.
   * Defaults to `DEFAULT_BLOCKING_INPUT_ANSWER_CAPACITY`.
   */
  readonly answerCapacity?: number;
}

/** Construct the blocking, Worker-backed execution host — see this module's doc comment. */
export function createWorkerExecutionHost(
  options: WorkerExecutionHostOptions,
): ExecutionHost {
  // The run currently owned by this host. All are set together by `execute()` and cleared together
  // the moment the run ends — by completion, or by `cancel()` abandoning it. A null `settle` is
  // precisely what makes a late report from an abandoned run a no-op: the controller has already
  // decided that run's outcome, so re-settling it would overwrite what the learner sees.
  //
  // `runId` covers the harder case a null cannot: Stop immediately followed by Run reinstalls a
  // callback, and the *previous* run — which a Worker only abandons once it wakes — then reports
  // into it. Every report carries the run it belongs to, so one comparison keeps a finished run's
  // events out of its successor.
  let channel: BlockingInputChannel | null = null;
  let request: ExecutionRequest | null = null;
  let settle: ExecutionSettle | null = null;
  let currentRunId = 0;

  function endRun(): void {
    channel = null;
    request = null;
    settle = null;
  }

  options.port.onReport((report) => {
    const activeSettle = settle;
    const activeRequest = request;
    if (
      activeSettle === null ||
      activeRequest === null ||
      report.runId !== currentRunId
    ) {
      return;
    }
    if (report.type === "read") {
      activeSettle({
        events: report.events,
        output: report.output,
        tutorOutput: report.tutorOutput,
        // A suspended run has not failed: `spec/interaction-events.md:108-111` is waiting, not
        // cancelling, so there is nothing to publish. The replay host withholds a diagnostic here
        // for the opposite reason — it really did cancel the attempt.
        diagnostics: [],
        pendingPrompt: report.prompt,
        retainedAnswers: activeRequest.answers,
      });
      return;
    }
    endRun();
    activeSettle({
      events: report.events,
      output: report.output,
      tutorOutput: report.tutorOutput,
      diagnostics: report.diagnostics,
      pendingPrompt: null,
      retainedAnswers: activeRequest.answers,
    });
  });

  return {
    execute(nextRequest, nextSettle) {
      // A fresh buffer per run is what re-arms cancellation: `reset()` needs no counterpart here,
      // because the flag a previous Stop set lives in memory this run never looks at.
      channel = createBlockingInputChannel(
        options.allocateBuffer(
          blockingInputBufferByteLength(options.answerCapacity),
        ),
      );
      request = nextRequest;
      settle = nextSettle;
      currentRunId += 1;
      options.port.postMessage({
        type: "run",
        runId: currentRunId,
        request: nextRequest,
        buffer: channel.control.buffer,
      });
    },
    cancel() {
      if (channel !== null) {
        requestBlockingCancellation(channel, options.notify);
      }
      endRun();
    },
    resolveRead(answer) {
      const activeChannel = channel;
      if (activeChannel === null) {
        return;
      }
      if (answer === undefined) {
        dismissBlockingRead(activeChannel, options.notify);
        return;
      }
      // An answer longer than the shared answer region is **refused, never truncated**: handing the
      // program text the learner did not type would be a silent corruption, and there is no way to
      // grow the buffer a blocked Worker is already holding. Ending the read unanswered cancels the
      // run with the runtime's own diagnostic — visible, bounded, and recoverable by running again.
      // `answerCapacity` is configurable precisely so a deployment can put this out of reach.
      if (
        !deliverBlockingAnswer(activeChannel, answer, options.notify).delivered
      ) {
        dismissBlockingRead(activeChannel, options.notify);
      }
    },
  };
}
