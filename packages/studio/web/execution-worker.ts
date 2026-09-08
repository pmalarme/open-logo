/**
 * The studio's execution Worker entry (#876) — the one place a real `Atomics.wait` appears.
 *
 * It is deliberately a **wiring layer only**: every decision lives in `src/execution-worker-runner.ts`,
 * which is inside the 100% coverage gate because its wait/post primitives are injected. This file
 * supplies the real ones and does nothing else, the same boundary `web/main.ts` keeps with
 * `src/web-bootstrap.ts`.
 *
 * `Atomics.wait` is what makes the `input` read a genuine suspension rather than a reconciliation:
 * `spec/interaction-events.md:169-172` requires that no OpenLogo instruction and no handler block
 * runs until a read finishes, and parking this thread is that guarantee by construction. It is only
 * legal off the main thread, which is exactly why the interpreter runs here.
 *
 * See `docs/adr/0023-worker-execution-host.md`.
 */

import { runExecutionWorkerCommand } from "../src/index.js";
import type {
  ExecutionWorkerCommand,
  ExecutionWorkerReport,
} from "../src/index.js";

/**
 * The dedicated-worker global, named locally. `tsconfig.web.json` loads `lib: ["ES2022", "DOM"]`,
 * whose `self` is a `Window` — and `lib.webworker` cannot be added alongside `DOM` without a wall of
 * conflicting declarations. Naming only the two members this file uses keeps that mismatch to one
 * documented line instead of leaking through the module.
 */
const workerScope = globalThis as unknown as {
  addEventListener(
    type: "message",
    listener: (event: { data: ExecutionWorkerCommand }) => void,
  ): void;
  postMessage(report: ExecutionWorkerReport): void;
};

workerScope.addEventListener("message", (event) => {
  runExecutionWorkerCommand(event.data, {
    wait: (control, index, expected, timeoutMs) =>
      Atomics.wait(control, index, expected, timeoutMs),
    post: (report) => {
      workerScope.postMessage(report);
    },
  });
});
