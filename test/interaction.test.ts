import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createWhistle,
  type WhistleInteractionEnd,
  type WhistlePresenter,
  type WhistlePrompt,
} from "../src/index.js";
import { createWhistleInteractionHost } from "../src/interaction.js";
import {
  decodePromptAnswer,
  parseNotice,
  parsePrompt,
  parsePromptAnswer,
} from "../src/wire.js";

describe("interaction schema", () => {
  it("admits the closed prompt and notice vocabulary", () => {
    expect(
      parsePrompt({
        type: "choice",
        message: "Choose a provider",
        options: [{ value: "a", label: "A", description: "API key" }],
      }),
    ).toEqual({
      type: "choice",
      message: "Choose a provider",
      options: [{ value: "a", label: "A", description: "API key" }],
    });
    expect(parsePrompt({ type: "text", message: "Key", secret: true })).toEqual(
      { type: "text", message: "Key", secret: true },
    );
    expect(
      parseNotice({
        type: "handoff",
        url: "https://example.test/device",
        code: "ABCD-EFGH",
      }),
    ).toMatchObject({ type: "handoff", code: "ABCD-EFGH" });
  });

  it("retains optional choice groups without changing the answer contract", () => {
    const prompt = {
      type: "choice",
      message: "Provider",
      collapsedGroup: "More providers",
      options: [
        { value: "deepseek", label: "DeepSeek", group: "More providers" },
      ],
    };
    const parsed = parsePrompt(prompt);
    expect(parsed).toEqual(prompt);
    expect(parsePromptAnswer(parsed, "deepseek")).toBe("deepseek");
    expect(() => parsePrompt({ ...prompt, collapsedGroup: " " })).toThrow();
    expect(() =>
      parsePrompt({
        ...prompt,
        options: [{ value: "a", label: "A", group: 1 }],
      }),
    ).toThrow();
  });

  it("rejects renderer-specific or malformed data", () => {
    expect(() =>
      parsePrompt({ type: "choice", message: "Pick", options: [] }),
    ).toThrow();
    expect(() =>
      parsePrompt({ type: "text", message: "Key", widget: "password" }),
    ).toThrow();
    expect(() => parsePrompt({ type: "form", message: "Fill" })).toThrow();
    expect(() =>
      parseNotice({ type: "handoff", url: "javascript:alert(1)" }),
    ).toThrow();
    expect(() => parseNotice({ type: "info", message: " " })).toThrow();
  });

  it("parses answers against their prompt", () => {
    const choice = parsePrompt({
      type: "choice",
      message: "Pick",
      options: [{ value: "a", label: "A" }],
    });
    expect(parsePromptAnswer(choice, "a")).toBe("a");
    expect(() => parsePromptAnswer(choice, "b")).toThrow();
    const invalid = decodePromptAnswer(choice, "b");
    expect(invalid.kind).toBe("invalid");
    if (invalid.kind === "invalid") expect(invalid.cause).toBeInstanceOf(Error);
    expect(
      parsePromptAnswer({ type: "confirmation", message: "Sure?" }, true),
    ).toBe(true);
    expect(() =>
      parsePromptAnswer({ type: "confirmation", message: "Sure?" }, "yes"),
    ).toThrow();
  });
});

describe("interaction host", () => {
  it("walks prompt, answer, handoff and success into snapshots", async () => {
    const ends: WhistleInteractionEnd[] = [];
    const host = createWhistleInteractionHost({
      title: "Sign in",
      onEnd: (end) => ends.push(end),
    });
    const session = host.begin();
    const answer = session.interaction.prompt({
      type: "choice",
      message: "Choose",
      options: [
        { value: "one", label: "One" },
        { value: "two", label: "Two" },
      ],
    });
    const pending = host.snapshot().prompt;
    expect(host.snapshot().status).toBe("prompting");
    expect(pending?.request.type).toBe("choice");
    expect(host.answer(pending?.sequence ?? -1, "three")).toBe(false);
    expect(host.answer((pending?.sequence ?? 0) + 1, "two")).toBe(false);
    expect(host.answer(pending?.sequence ?? -1, "two")).toBe(true);
    await expect(answer).resolves.toBe("two");
    session.interaction.notify({
      type: "handoff",
      url: "https://example.test/device",
      code: "WXYZ",
    });
    session.interaction.notify({ type: "progress", message: "Waiting" });
    expect(host.snapshot()).toMatchObject({
      status: "working",
      handoff: { code: "WXYZ" },
      message: { type: "progress", message: "Waiting" },
    });
    session.settle({ status: "handled" });
    expect(host.snapshot().status).toBe("done");
    expect(ends).toEqual([{ status: "handled" }]);
  });

  it("captures a choice contract before the caller can mutate its options", async () => {
    const host = createWhistleInteractionHost({ title: "Choose" });
    const session = host.begin();
    const options = [{ value: "original", label: "Original" }];
    const answer = session.interaction.prompt({
      type: "choice",
      message: "Pick",
      options,
    });
    expectTypeOf(answer).toEqualTypeOf<Promise<string>>();
    options[0] = { value: "replacement", label: "Replacement" };
    const own = host.snapshot().prompt?.sequence ?? -1;
    expect(host.answer(own, "replacement")).toBe(false);
    expect(host.answer(own, "original")).toBe(true);
    await expect(answer).resolves.toBe("original");
  });

  it("preserves boolean answers and the answer union for a dynamic prompt", async () => {
    const host = createWhistleInteractionHost({ title: "Confirm" });
    const session = host.begin();
    const confirmation = {
      type: "confirmation",
      message: "Sure?",
    } satisfies WhistlePrompt;
    const answer = session.interaction.prompt(confirmation);
    expectTypeOf(answer).toEqualTypeOf<Promise<boolean>>();
    const own = host.snapshot().prompt?.sequence ?? -1;
    expect(host.answer(own, "yes")).toBe(false);
    expect(host.answer(own, false)).toBe(true);
    await expect(answer).resolves.toBe(false);
    const dynamic: WhistlePrompt =
      host.snapshot().prompt?.request ?? confirmation;
    expectTypeOf(parsePromptAnswer(dynamic, false)).toEqualTypeOf<
      string | boolean
    >();
  });

  it("cancels a pending prompt and reports a cancelled end", async () => {
    const ends: WhistleInteractionEnd[] = [];
    const host = createWhistleInteractionHost({
      title: "Sign in",
      onEnd: (end) => ends.push(end),
    });
    const session = host.begin();
    const answer = session.interaction.prompt({ type: "text", message: "Key" });
    host.cancel();
    await expect(answer).rejects.toThrow("Interaction cancelled");
    expect(session.interaction.signal.aborted).toBe(true);
    session.settle({ status: "failed", message: "aborted" });
    expect(ends).toEqual([{ status: "cancelled" }]);
    expect(host.snapshot().status).toBe("cancelled");
  });

  it("withdraws one prompt without ending the interaction", async () => {
    const host = createWhistleInteractionHost({ title: "Sign in" });
    const session = host.begin();
    const withdraw = new AbortController();
    const answer = session.interaction.prompt(
      { type: "text", message: "Paste the code" },
      { signal: withdraw.signal },
    );
    expect(host.snapshot().status).toBe("prompting");
    withdraw.abort(new Error("callback won"));
    await expect(answer).rejects.toThrow("callback won");
    expect(host.snapshot()).toMatchObject({ status: "working" });
    expect(host.snapshot().prompt).toBeUndefined();
    expect(session.interaction.signal.aborted).toBe(false);
  });

  it("keeps a failure visible until retried or dismissed", () => {
    const ends: WhistleInteractionEnd[] = [];
    const host = createWhistleInteractionHost({
      title: "Sign in",
      onEnd: (end) => ends.push(end),
    });
    host.begin().settle({ status: "failed", message: "Refused" });
    expect(host.snapshot()).toMatchObject({
      status: "failed",
      failure: "Refused",
    });
    const retry = host.begin();
    expect(host.snapshot()).toMatchObject({ status: "working" });
    expect(host.snapshot().failure).toBeUndefined();
    retry.settle({ status: "failed", message: "Refused again" });
    host.cancel();
    expect(ends.at(-1)).toEqual({ status: "cancelled" });
  });

  it("parses command-supplied prompts before rendering them", async () => {
    const host = createWhistleInteractionHost({ title: "Bad" });
    const session = host.begin();
    await expect(async () =>
      session.interaction.prompt({
        type: "choice",
        message: "Pick",
        options: [],
      }),
    ).rejects.toThrow();
    expect(host.snapshot().prompt).toBeUndefined();
  });
});

describe("runtime presenter", () => {
  function recordingPresenter() {
    const opened: string[] = [];
    const ends: WhistleInteractionEnd[] = [];
    const presenter: WhistlePresenter = ({ commandId }) => {
      opened.push(commandId);
      const host = createWhistleInteractionHost({
        title: commandId,
        onEnd: (end) => ends.push(end),
      });
      return host.begin();
    };
    return { presenter, opened, ends };
  }

  it("gives human executions an interaction and settles it", async () => {
    const whistle = createWhistle();
    const { presenter, opened, ends } = recordingPresenter();
    const dispose = whistle.present(presenter);
    let seen = false;
    whistle.contribute({
      sourceId: "s",
      namespace: "account",
      commands: [
        {
          id: "login",
          title: "Sign in",
          category: "Account",
          handler: ({ interaction }) => {
            seen = interaction !== undefined;
          },
        },
        {
          id: "broken",
          title: "Broken",
          category: "Account",
          handler: () => {
            throw new Error("Refused");
          },
        },
      ],
    });
    await whistle.execute("account:login", { origin: "slash" });
    expect(seen).toBe(true);
    await whistle.execute("account:login", { origin: "agent" });
    expect(seen).toBe(false);
    await whistle.execute("account:broken", { origin: "menu" });
    expect(opened).toEqual(["account:login", "account:broken"]);
    expect(ends).toEqual([
      { status: "handled" },
      { status: "failed", message: "Refused" },
    ]);
    dispose();
    await whistle.execute("account:login", { origin: "slash" });
    expect(seen).toBe(false);
  });

  it("prefers a caller-supplied interaction", async () => {
    const whistle = createWhistle();
    const { presenter, opened } = recordingPresenter();
    whistle.present(presenter);
    const own = createWhistleInteractionHost({ title: "own" }).begin();
    let received: unknown;
    whistle.contribute({
      sourceId: "s",
      namespace: "account",
      commands: [
        {
          id: "login",
          title: "Sign in",
          category: "Account",
          handler: ({ interaction }) => {
            received = interaction;
          },
        },
      ],
    });
    await whistle.execute("account:login", {
      origin: "slash",
      interaction: own.interaction,
    });
    expect(received).toBe(own.interaction);
    expect(opened).toEqual([]);
  });
});
