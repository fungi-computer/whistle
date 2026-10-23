import { parsePromptAnswer } from "../src/wire.js";
import { describe, expect, it, vi } from "vitest";
import { createWhistleInteractionHost } from "../src/interaction.js";

import {
  catalogCommands,
  parseCatalog,
  parseCatalogStep,
  whistleCatalogProtocol,
} from "../src/catalog.js";
import {
  createWhistle,
  type WhistleInteraction,
  type WhistleJsonObject,
  type WhistlePrompt,
} from "../src/index.js";

/** The wire fixture every catalog producer must keep parsing. */
const catalogFixture = {
  protocol: "whistle.catalog/v1",
  commands: [
    {
      id: "goal",
      title: "Session goal",
      category: "Session",
      description: "View, set or pause the goal",
      projections: {
        help: { order: 2 },
        slash: {
          aliases: ["goal"],
          order: 2,
          arguments: {
            hint: "<objective>",
            words: [
              {
                word: "pause",
                description: "Pause the goal",
                arguments: { action: "pause" },
              },
            ],
            text: {
              field: "objective",
              arguments: { action: "set" },
              requestIdField: "requestId",
            },
          },
        },
      },
      availability: { status: "available" },
    },
  ],
};

describe("whistle.catalog/v1 contract", () => {
  it.each(["key", "__proto__"])(
    "drops secret argument %s after each attempt and re-asks only the secret on retry",
    async (field) => {
      const runtime = createWhistle();
      const host = createWhistleInteractionHost({ title: "Connect provider" });
      runtime.present(() => host.begin());
      const captured: WhistleJsonObject[] = [];
      const questions: string[] = [];
      let submitted = 0;
      runtime.contribute({
        sourceId: "secret-retry",
        namespace: "secret",
        commands: catalogCommands(
          parseCatalog({
            protocol: whistleCatalogProtocol,
            commands: [
              {
                id: "connect",
                title: "Connect provider",
                category: "Settings",
              },
            ],
          }),
          (_command, args) => {
            captured.push(args);
            if (args.provider === undefined)
              return Promise.resolve({
                type: "prompt",
                prompt: {
                  type: "choice",
                  message: "Provider?",
                  options: [{ value: "beta", label: "Beta" }],
                },
                next: { arguments: { method: "api_key" }, answer: "provider" },
              });
            if (args.method !== "api_key") throw new Error("Missing method");
            if (args.stage !== "submit")
              return Promise.resolve({
                type: "prompt",
                prompt: { type: "text", message: "API key?", secret: true },
                next: {
                  arguments: {
                    provider: args.provider,
                    method: args.method,
                    stage: "submit",
                  },
                  answer: field,
                },
              });
            submitted += 1;
            expect(args.provider).toBe("beta");
            expect(args.method).toBe("api_key");
            expect(args[field]).toBe(
              submitted === 1 ? "first-fixture-secret" : "fresh-fixture-secret",
            );
            return submitted === 1
              ? Promise.reject(new Error("Credential service unavailable"))
              : Promise.resolve({ type: "done", result: "connected" });
          },
        ),
      });
      const running = runtime.execute("secret:connect", { origin: "slash" });
      const answer = async (value: string) => {
        await vi.waitFor(() => {
          expect(host.snapshot().prompt).toBeDefined();
        });
        const pending = host.snapshot().prompt;
        if (pending === undefined) throw new Error("Missing question");
        questions.push(pending.request.message);
        host.answer(pending.sequence, value);
      };
      try {
        await answer("beta");
        await answer("first-fixture-secret");
        await vi.waitFor(() => {
          expect(host.snapshot().retryable).toBe(true);
        });
        expect(Object.hasOwn(captured.at(-1) ?? {}, field)).toBe(false);
        host.retry();
        await answer("fresh-fixture-secret");
        expect((await running).status).toBe("handled");
        expect(questions).toEqual(["Provider?", "API key?", "API key?"]);
        expect(submitted).toBe(2);
        for (const args of captured)
          expect(Object.hasOwn(args, field)).toBe(false);
      } finally {
        host.cancel();
        await running;
        runtime.close();
      }
    },
  );

  it("keeps only question metadata when a later step carries two secret fields", async () => {
    const runtime = createWhistle();
    const host = createWhistleInteractionHost({ title: "Two credentials" });
    runtime.present(() => host.begin());
    const captured: WhistleJsonObject[] = [];
    let submitted = 0;
    runtime.contribute({
      sourceId: "two-secrets",
      namespace: "two",
      commands: catalogCommands(parseCatalog(catalogFixture), (_id, args) => {
        captured.push(args);
        if (args.stage === undefined)
          return Promise.resolve({
            type: "prompt",
            prompt: { type: "text", message: "Key?", secret: true },
            next: { arguments: { stage: "password" }, answer: "key" },
          });
        if (args.stage === "password") {
          expect(args.key).toBe("initial-key");
          return Promise.resolve({
            type: "prompt",
            prompt: { type: "text", message: "Password?", secret: true },
            next: {
              arguments: { ...args, stage: "submit" },
              answer: "password",
            },
          });
        }
        submitted += 1;
        expect(args.key).toBe(submitted === 1 ? "attempt-key" : "fresh-key");
        expect(args.password).toBe(
          submitted === 1 ? "attempt-password" : "fresh-password",
        );
        return submitted === 1
          ? Promise.reject(new Error("Try fresh credentials"))
          : Promise.resolve({ type: "done" });
      }),
    });
    const running = runtime.execute("two:goal", { origin: "slash" });
    const answer = async (message: string, value: string) => {
      await vi.waitFor(() => {
        expect(host.snapshot().prompt?.request.message).toBe(message);
      });
      const pending = host.snapshot().prompt;
      if (pending === undefined) throw new Error("Missing secret question");
      host.answer(pending.sequence, value);
    };
    try {
      await answer("Key?", "initial-key");
      await answer("Key?", "attempt-key");
      await answer("Password?", "attempt-password");
      await vi.waitFor(() => {
        expect(host.snapshot().retryable).toBe(true);
      });
      for (const args of captured) {
        expect(Object.hasOwn(args, "key")).toBe(false);
        expect(Object.hasOwn(args, "password")).toBe(false);
      }
      host.retry();
      await answer("Key?", "fresh-key");
      await answer("Password?", "fresh-password");
      expect((await running).status).toBe("handled");
      expect(submitted).toBe(2);
      for (const args of captured) {
        expect(Object.hasOwn(args, "key")).toBe(false);
        expect(Object.hasOwn(args, "password")).toBe(false);
      }
    } finally {
      host.cancel();
      await running;
      runtime.close();
    }
  });

  it("parses the versioned catalog fixture", () => {
    const catalog = parseCatalog(catalogFixture);
    expect(catalog.protocol).toBe(whistleCatalogProtocol);
    expect(catalog.commands[0]?.projections?.slash?.arguments?.hint).toBe(
      "<objective>",
    );
  });

  it("rejects another version, unknown fields and repeated commands", () => {
    expect(() =>
      parseCatalog({ ...catalogFixture, protocol: "whistle.catalog/v2" }),
    ).toThrow();
    expect(() => parseCatalog({ ...catalogFixture, extra: true })).toThrow();
    expect(() =>
      parseCatalog({
        ...catalogFixture,
        commands: [catalogFixture.commands[0], catalogFixture.commands[0]],
      }),
    ).toThrow(/repeated/u);
    expect(() =>
      parseCatalog({
        ...catalogFixture,
        commands: [
          {
            ...catalogFixture.commands[0],
            projections: {
              slash: { aliases: ["goal"], arguments: { hint: "<x>" } },
            },
          },
        ],
      }),
    ).toThrow();
  });

  it("parses steps and refuses malformed prompts", () => {
    expect(
      parseCatalogStep({
        type: "prompt",
        prompt: { type: "confirmation", message: "Replace?" },
        next: { arguments: { action: "set" }, answer: "confirmed" },
      }),
    ).toMatchObject({ type: "prompt", next: { answer: "confirmed" } });
    expect(() =>
      parseCatalogStep({
        type: "prompt",
        prompt: { type: "widget" },
        next: { arguments: {}, answer: "x" },
      }),
    ).toThrow();
    expect(
      parseCatalogStep({
        type: "done",
        notice: { type: "success", message: "Done" },
        result: { ok: true },
      }),
    ).toEqual({
      type: "done",
      notice: { type: "success", message: "Done" },
      result: { ok: true },
    });
  });
});

function scriptedInteraction(answers: (string | boolean)[]) {
  const asked: WhistlePrompt[] = [];
  const notices: string[] = [];
  const interaction: WhistleInteraction = {
    run: (operation) => operation(),
    signal: new AbortController().signal,
    prompt: (prompt) => {
      asked.push(prompt);
      const answer = answers.shift();
      if (answer === undefined)
        throw new Error("Missing scripted prompt answer");
      return Promise.resolve(parsePromptAnswer(prompt, answer));
    },
    notify: (notice) => {
      notices.push(notice.type === "handoff" ? notice.url : notice.message);
    },
  };
  return { interaction, asked, notices };
}

describe("catalog commands", () => {
  it("runs a backend step conversation through the interaction", async () => {
    const calls: WhistleJsonObject[] = [];
    const whistle = createWhistle();
    whistle.contribute({
      sourceId: "backend",
      namespace: "goal",
      commands: catalogCommands(parseCatalog(catalogFixture), (_, args) => {
        calls.push(args);
        return Promise.resolve(
          args.confirmed === undefined
            ? {
                type: "prompt",
                prompt: { type: "confirmation", message: "Replace?" },
                next: {
                  arguments: { ...args, revision: "r1" },
                  answer: "confirmed",
                },
              }
            : { type: "done", notice: { type: "success", message: "Set" } },
        );
      }),
    });
    const { interaction, asked, notices } = scriptedInteraction([true]);
    const outcome = await whistle.execute("goal:goal", {
      origin: "slash",
      arguments: { action: "set", objective: "Ship" },
      interaction,
    });
    expect(outcome).toEqual({ status: "handled" });
    expect(asked).toEqual([{ type: "confirmation", message: "Replace?" }]);
    expect(calls).toEqual([
      { action: "set", objective: "Ship" },
      { action: "set", objective: "Ship", revision: "r1", confirmed: true },
    ]);
    expect(notices).toEqual(["Set"]);
    expect(whistle.snapshot().slash[0]?.arguments?.hint).toBe("<objective>");
  });

  it("refuses a prompt to an Agent", async () => {
    const whistle = createWhistle();
    whistle.contribute({
      sourceId: "backend",
      namespace: "goal",
      commands: catalogCommands(parseCatalog(catalogFixture), () =>
        Promise.resolve({
          type: "prompt",
          prompt: { type: "text", message: "Objective?" },
          next: { arguments: {}, answer: "objective" },
        }),
      ),
    });
    const outcome = await whistle.execute("goal:goal", { origin: "agent" });
    expect(outcome).toMatchObject({
      status: "failed",
      error: { code: "interaction_required" },
    });
  });

  it("offers a choice presentation before the first call", async () => {
    const calls: WhistleJsonObject[] = [];
    const whistle = createWhistle();
    whistle.contribute({
      sourceId: "backend",
      namespace: "loop",
      commands: catalogCommands(
        parseCatalog({
          protocol: "whistle.catalog/v1",
          commands: [
            {
              id: "loop",
              title: "Loop",
              category: "Session",
              action: {
                presentation: {
                  type: "choice",
                  options: [
                    { label: "Pause", value: { action: "pause" } },
                    { label: "Stop", value: { action: "stop" } },
                  ],
                },
              },
            },
          ],
        }),
        (_, args) => {
          calls.push(args);
          return Promise.resolve({ type: "done" });
        },
      ),
    });
    const { interaction } = scriptedInteraction(["1"]);
    await whistle.execute("loop:loop", { origin: "slash", interaction });
    expect(calls).toEqual([{ action: "stop" }]);
  });
});
