import { parsePromptAnswer } from "../src/wire.js";
import { describe, expect, it } from "vitest";

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
