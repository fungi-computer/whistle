import type {
  WhistleInteraction,
  WhistleInteractionEnd,
  WhistleInteractionSession,
  WhistleNotice,
  WhistleNoticeLink,
  WhistlePrompt,
} from "./index.js";
import {
  parseNotice,
  parsePrompt,
  createPromptAnswerDecoder,
  type WhistlePromptOf,
  type WhistlePromptAnswers,
} from "./wire.js";

/** Where one interaction is in its life. */
export type WhistleInteractionStatus =
  "working" | "prompting" | "failed" | "done" | "cancelled";

/** The one pending question, with the sequence its answer must name. */
export type WhistlePendingPrompt = Readonly<{
  /** Identity the answer must name; a stale answer is ignored. */
  sequence: number;
  /** The parsed question. */
  request: WhistlePrompt;
}>;

/** A notice that carries a message line. */
export type WhistleMessageNotice = Extract<
  WhistleNotice,
  Readonly<{
    /** Notice kinds that carry a message line. */
    type: "info" | "progress" | "success";
  }>
>;

/** A "continue elsewhere" notice. */
export type WhistleHandoffNotice = Extract<
  WhistleNotice,
  Readonly<{
    /** The handoff notice kind. */
    type: "handoff";
  }>
>;

/** Everything a renderer needs to draw one interaction. */
export type WhistleInteractionSnapshot = Readonly<{
  /** The command title. */
  title: string;
  /** Where the interaction is in its life. */
  status: WhistleInteractionStatus;
  /** Latest info, progress or success message. */
  message?: WhistleMessageNotice | undefined;
  /** Latest "continue elsewhere" step, kept until the interaction ends. */
  handoff?: WhistleHandoffNotice | undefined;
  /** Links from the latest info notice. */
  links: readonly WhistleNoticeLink[];
  /** The question waiting for an answer. */
  prompt?: WhistlePendingPrompt | undefined;
  /** Failure message while status is "failed". */
  failure?: string | undefined;
}>;

/** A renderer-neutral store behind one interaction dialog or panel. */
export type WhistleInteractionHost = Readonly<{
  /** The current immutable snapshot. */
  snapshot: () => WhistleInteractionSnapshot;
  /** Observe snapshot changes. */
  subscribe: (listener: () => void) => () => void;
  /** Start one attempt; a retry calls this again. */
  begin: () => WhistleInteractionSession;
  /** Answer the pending prompt; a stale sequence or invalid value is ignored. */
  answer: (sequence: number, value: string | boolean) => boolean;
  /** Dismiss: abort the attempt, or close a settled failure. */
  cancel: () => void;
}>;

type Waiting = Readonly<{
  sequence: number;
  request: WhistlePrompt;
  resolve: (value: string | boolean) => boolean;
}>;

/**
 * Own one interaction's state for any renderer. Prompts and notices are
 * parsed here, at the boundary where command-supplied data becomes UI.
 */
export function createWhistleInteractionHost(
  options: Readonly<{
    title: string;
    onEnd?: (end: WhistleInteractionEnd) => void;
  }>,
): WhistleInteractionHost {
  const listeners = new Set<() => void>();
  let state: WhistleInteractionSnapshot = {
    title: options.title,
    status: "working",
    links: [],
  };
  let attempt: AbortController | undefined;
  let waiting: Waiting | undefined;
  let sequence = 0;
  const publish = (next: Partial<WhistleInteractionSnapshot>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  const end = (result: WhistleInteractionEnd) => {
    waiting = undefined;
    if (result.status === "failed")
      publish({ status: "failed", failure: result.message, prompt: undefined });
    else
      publish({
        status: result.status === "handled" ? "done" : "cancelled",
        prompt: undefined,
      });
    options.onEnd?.(result);
  };
  return {
    snapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    begin: () => {
      attempt?.abort();
      const controller = new AbortController();
      attempt = controller;
      const signal = controller.signal;
      waiting = undefined;
      state = { title: options.title, status: "working", links: [] };
      publish({});
      const current = () => attempt === controller && !signal.aborted;
      const interaction: WhistleInteraction = {
        signal,
        prompt: <Kind extends WhistlePrompt["type"]>(
          raw: WhistlePromptOf<Kind>,
          promptOptions?: Readonly<{ signal?: AbortSignal }>,
        ) => {
          const promptSignal =
            promptOptions?.signal === undefined
              ? signal
              : AbortSignal.any([signal, promptOptions.signal]);
          promptSignal.throwIfAborted();
          const request = parsePrompt(raw);
          const decodeAnswer = createPromptAnswerDecoder(raw);
          const answer = Promise.withResolvers<WhistlePromptAnswers[Kind]>();
          const own = ++sequence;
          const abort = () => {
            if (waiting?.sequence === own) {
              waiting = undefined;
              if (current()) publish({ status: "working", prompt: undefined });
            }
            answer.reject(promptSignal.reason);
          };
          promptSignal.addEventListener("abort", abort, { once: true });
          waiting = {
            sequence: own,
            request,
            resolve: (value) => {
              const outcome = decodeAnswer(value);
              if (outcome.kind === "invalid") return false;
              promptSignal.removeEventListener("abort", abort);
              answer.resolve(outcome.value);
              return true;
            },
          };
          publish({
            status: "prompting",
            prompt: { sequence: own, request },
          });
          return answer.promise;
        },
        notify: (raw) => {
          if (!current()) return;
          const notice = parseNotice(raw);
          if (notice.type === "handoff") publish({ handoff: notice });
          else
            publish({
              message: notice,
              links:
                notice.type === "info" ? (notice.links ?? []) : state.links,
            });
        },
      };
      return {
        interaction,
        settle: (result) => {
          if (attempt !== controller) return;
          attempt = undefined;
          end(signal.aborted ? { status: "cancelled" } : result);
        },
      };
    },
    answer: (own, value) => {
      const pending = waiting;
      if (pending?.sequence !== own) return false;
      if (!pending.resolve(value)) return false;
      waiting = undefined;
      publish({ status: "working", prompt: undefined });
      return true;
    },
    cancel: () => {
      if (attempt !== undefined) {
        publish({ prompt: undefined });
        attempt.abort(new Error("Interaction cancelled"));
        return;
      }
      if (state.status === "failed") end({ status: "cancelled" });
    },
  };
}
export { interactionTextLimit } from "./wire.js";
