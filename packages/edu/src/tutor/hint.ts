/**
 * The baseline, deterministic `hint` template (`spec/educational-model.md#hint`,
 * `spec/execution-model.md#tutor-output-educational-profile`). This is the A4 slice (#333): a
 * pure `TutorContext -> TutorOutput` mapping with no AI, no Socratic dialogue, and no mutable
 * state — the four-stage nudge -> concept -> partial -> last-resort progression is entirely
 * driven by {@link TutorContext.priorHintStage}, which a separate runtime-dispatch slice (A2,
 * #332) is responsible for threading across repeated `hint` invocations for the same
 * `target-source-span`.
 *
 * Every stage is built only from data already on the context (the learner's level and, when
 * known, the target callee's metadata) — never from the learner's actual challenge parameters —
 * so the guardrail in `spec/execution-model.md:629-639` holds unconditionally: no stage, not even
 * `"last-resort"`, can ever assemble into a complete, ready-to-run OpenLogo program. Stage 3
 * ("partial") and stage 4 ("last-resort") each surface a worked *skeleton* for the learner's
 * current level's concept, but every skeleton uses `‹placeholder›` markers (guillemets are not
 * OpenLogo syntax) instead of concrete values, so the skeleton itself never parses as valid
 * OpenLogo — see `hint.test.mjs` for a test that asserts exactly that for every stage.
 */

import type { TutorHintStage } from "@openlogo/core";
import type {
  TutorCommandMetadata,
  TutorContext,
  TutorLearnerLevel,
  TutorOutput,
} from "../tutor-context.js";

/** The nudge -> concept -> partial -> last-resort order (`spec/educational-model.md:496-501`). */
const HINT_STAGE_ORDER: readonly TutorHintStage[] = [
  "nudge",
  "concept",
  "partial",
  "last-resort",
];

/**
 * Computes the next stage in the progression given the previously shown stage for this
 * `target-source-span`, per `spec/execution-model.md:640-652`: absent -> `"nudge"`; each known
 * stage escalates by one; `"last-resort"` (or any stage past it) stays at `"last-resort"` rather
 * than fabricating a fifth stage.
 */
function nextHintStage(priorStage: TutorHintStage | undefined): TutorHintStage {
  if (priorStage === undefined) {
    return "nudge";
  }
  const priorIndex = HINT_STAGE_ORDER.indexOf(priorStage);
  const nextIndex = priorIndex + 1;
  const nextStage = HINT_STAGE_ORDER[nextIndex];
  return nextStage ?? "last-resort";
}

/**
 * The learner-facing concept name and a generic worked skeleton for each curriculum level
 * (`spec/educational-model.md`'s "Concept to command map" and "8 progressive LEVELS"). Every
 * skeleton is a *shape*, not this learner's actual challenge: it names the construct with
 * `‹placeholder›` markers standing in for whatever concrete names/numbers the learner's own
 * program needs, mirroring the spec's own partial-stage example ("For a shape with `:sides`, the
 * turn can use `360 / :sides`.") without ever supplying this challenge's real values.
 */
const LEVEL_CONCEPTS: Record<
  TutorLearnerLevel,
  { readonly name: string; readonly skeleton: string }
> = {
  "1": {
    name: "movement and turning",
    skeleton: "forward ‹distance› right ‹angle›",
  },
  "2": {
    name: "repetition with `repeat`",
    skeleton: "repeat ‹count› [ forward ‹distance› right ‹angle› ]",
  },
  "3": {
    name: "variables (`:name`)",
    skeleton: ":‹name› = ‹value› forward :‹name›",
  },
  "4": {
    name: "conditions (`if`)",
    skeleton: "if :‹name› > ‹value› [ forward :‹name› ]",
  },
  "5": {
    name: "procedures (`define … end`)",
    skeleton: "define ‹name› local :‹parameter› ‹body› end",
  },
  "6": {
    name: "geometry built from `repeat` and turns",
    skeleton: "repeat ‹sides› [ forward ‹length› right 360 / ‹sides› ]",
  },
  "7a": {
    name: "lists",
    skeleton: ":‹name› = [ ‹item› ‹item› ]",
  },
  "7b": {
    name: "dictionaries",
    skeleton: ":‹name› = { ‹key›: ‹value› }",
  },
  "7c": {
    name: "records",
    skeleton: "struct ‹TypeName› { ‹field›: ‹value› }",
  },
  "8a": {
    name: "recursion",
    skeleton:
      "define ‹name› if ‹condition› [ return ‹value› ] ‹name› ‹smaller-input› end",
  },
  "8b": {
    name: "comprehensions",
    skeleton: "map ‹item› in :‹list› [ ‹expression› ]",
  },
};

/**
 * A short, learner-facing label for the target the hint is about — the callee name when the
 * context identifies one, otherwise a generic reference to the selected instruction
 * (`spec/educational-model.md:498`'s "point attention to the relevant place").
 */
function describeTarget(
  commandMetadata: TutorCommandMetadata | undefined,
): string {
  if (commandMetadata === undefined) {
    return "the highlighted part of your program";
  }
  if (commandMetadata.kind === "procedure") {
    return `your procedure \`${commandMetadata.name}\``;
  }
  return `\`${commandMetadata.name}\``;
}

/**
 * Builds the single learner-facing segment for `stage`, following the four progression bullets
 * verbatim from `spec/educational-model.md:498-501`.
 */
function segmentForStage(
  stage: TutorHintStage,
  targetLabel: string,
  concept: { readonly name: string; readonly skeleton: string },
  level: TutorLearnerLevel,
): string {
  switch (stage) {
    case "nudge":
      return (
        `Look closely at ${targetLabel}. What is it doing right now, and how does that ` +
        "compare with what you want to happen?"
      );
    case "concept":
      return (
        `This is a case for ${concept.name} (level ${level}). Think about how that idea ` +
        "works before you change anything."
      );
    case "partial":
      return (
        `Here is the shape of that idea with different names and numbers: \`${concept.skeleton}\`. ` +
        `Compare it to ${targetLabel} — what is similar, and what is different?`
      );
    case "last-resort":
      return (
        `As a last step, try restructuring ${targetLabel} to follow that same shape — for ` +
        `example \`${concept.skeleton}\` — then fill in the specific values that match your ` +
        "goal yourself."
      );
  }
}

/**
 * The baseline `hint` template (`spec/educational-model.md#hint`): a pure, deterministic mapping
 * from a `TutorContext` whose {@link TutorContext.command} is `"hint"` to the `tutor-output`
 * payload for the next stage in the progression. Calling this twice with the same `context` (in
 * particular, the same {@link TutorContext.priorHintStage}) always returns a value that is
 * `deepEqual` to the first — there is no hidden state here; the caller (the runtime dispatch
 * slice, A2/#332) is solely responsible for tracking `priorHintStage` per `target-source-span`
 * across repeated invocations.
 *
 * @throws {Error} when `context.command` is not `"hint"` — a programmer error, not a learner-
 * facing `ol-*` diagnostic: callers must route `hint` invocations here and route
 * `explain`/`why`/`debug` to their own templates.
 */
export function hint(context: TutorContext): TutorOutput {
  if (context.command !== "hint") {
    throw new Error(
      `hint() requires a TutorContext whose command is "hint"; received "${context.command}".`,
    );
  }

  const stage = nextHintStage(context.priorHintStage);
  const concept = LEVEL_CONCEPTS[context.level];
  const targetLabel = describeTarget(context.commandMetadata);
  const targetSourceSpan =
    context.target?.source_span ?? context.program.source_span;

  return {
    command: "hint",
    segments: [segmentForStage(stage, targetLabel, concept, context.level)],
    stage,
    target_source_span: targetSourceSpan,
  };
}
