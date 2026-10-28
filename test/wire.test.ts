import { expect, it } from "vitest";

import {
  createWhistle,
  type WhistleAvailability,
  type WhistleCommandDefinition,
} from "../src/index.js";
import {
  WhistleAgentProjectionSchema,
  decodePromptAnswer,
  parse,
  parsePrompt,
} from "../src/wire.js";

const validCommandDefinition: WhistleCommandDefinition = {
  id: "open",
  title: "Open",
  category: "navigation",
  availability: { status: "available" },
};
void validCommandDefinition;

// @ts-expect-error Availability is a schema-owned discriminated union.
const invalidAvailability: WhistleAvailability = { status: "unknown" };
void invalidAvailability;

const invalidCommandDefinition: WhistleCommandDefinition = {
  id: "open",
  title: "Open",
  category: "navigation",
  // @ts-expect-error Command definitions reject unknown transport fields.
  handler: () => undefined,
};
void invalidCommandDefinition;

it("roundtrips the agent rows emitted by createWhistle", () => {
  const whistle = createWhistle();
  whistle.contribute({
    sourceId: "wire-source",
    namespace: "wire",
    scope: "wire-pane",
    commands: [
      {
        id: "annotated",
        title: "Annotated",
        category: "agent",
        description: "A semantic command",
        projections: { agent: { order: 2, keybind: "ctrl+a" } },
        action: {
          inputSchema: {
            type: "object",
            properties: {
              target: { type: "string", "x-custom": { nested: [1, true] } },
            },
            "x-root": { annotation: "preserve" },
          },
          outputSchema: { type: "object", "x-result": ["kept", null] },
          presentation: { type: "custom", data: { private: "ui" } },
        },
        handler: () => undefined,
      },
      {
        id: "presentation-only",
        title: "Presentation only",
        category: "agent",
        projections: { agent: { order: 1 } },
        action: { presentation: { type: "action" } },
        availability: () => ({ status: "unavailable", reason: "busy" }),
        handler: () => undefined,
      },
    ],
  });

  const snapshot = whistle.snapshot();
  const decoded = parse(JSON.parse(JSON.stringify(snapshot.agent)));
  expect(decoded).toEqual(snapshot.agent);
  expect(decoded.map((row) => row.scope)).toEqual(["wire-pane", "wire-pane"]);
  expect(decoded[0]?.action).toEqual({});
  expect(decoded[0]).not.toHaveProperty("description");
  expect(decoded[0]).not.toHaveProperty("keybind");
  expect(decoded[0]?.action).not.toHaveProperty("inputSchema");
  expect(decoded[0]?.action).not.toHaveProperty("outputSchema");
  expect(decoded[1]?.action).toEqual({
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", "x-custom": { nested: [1, true] } },
      },
      "x-root": { annotation: "preserve" },
    },
    outputSchema: { type: "object", "x-result": ["kept", null] },
  });
  expect(decoded[0]?.availability).toEqual({
    status: "unavailable",
    reason: "busy",
  });
  expect(decoded[1]).not.toHaveProperty("presentation");
});

it("rejects malformed fixed rows and presentation fields", () => {
  expect(() =>
    WhistleAgentProjectionSchema.parse({
      commandId: "wire:bad",
      sourceId: "wire-source",
      title: "Bad",
      category: "agent",
      order: 0,
      availability: { status: "available" },
      description: null,
    }),
  ).toThrow();

  expect(() =>
    WhistleAgentProjectionSchema.parse({
      commandId: "wire:bad",
      sourceId: "wire-source",
      title: "Bad",
      category: "agent",
      order: 0,
      availability: { status: "unavailable" },
    }),
  ).toThrow();

  expect(() =>
    WhistleAgentProjectionSchema.parse({
      commandId: "wire:bad",
      sourceId: "wire-source",
      title: "Bad",
      category: "agent",
      order: 0,
      availability: { status: "available" },
      action: { presentation: { type: "custom", data: {} } },
    }),
  ).toThrow();
});

const decisionPrompt = (multiple?: boolean) =>
  parsePrompt({
    type: "decision",
    message: "Which database?",
    options: [
      { value: "pg", label: "Postgres", description: "Recommended" },
      { value: "sqlite", label: "SQLite" },
    ],
    other: { label: "Other…", maxLength: 40 },
    multiple,
  });

it("decision answer rejects unknown labels and empty single answers", () => {
  const single = decisionPrompt();
  if (single.type !== "decision") throw new Error("expected a decision");
  const accepted = (value: Parameters<typeof decodePromptAnswer>[1]) =>
    decodePromptAnswer(single, value).kind === "accepted";
  expect(accepted({ selected: ["pg"] })).toBe(true);
  expect(accepted({ selected: [], text: "MySQL" })).toBe(true);
  expect(accepted({ selected: ["mysql"] })).toBe(false);
  expect(accepted({ selected: [] })).toBe(false);
  expect(accepted({ selected: [], text: "   " })).toBe(false);
  expect(accepted({ selected: ["pg", "sqlite"] })).toBe(false);
  expect(accepted({ selected: ["pg"], text: "and more" })).toBe(false);
  expect(accepted({ selected: [], text: "x".repeat(41) })).toBe(false);
  expect(accepted("pg")).toBe(false);
});

it("a multiple decision takes each offered option once", () => {
  const multiple = decisionPrompt(true);
  if (multiple.type !== "decision") throw new Error("expected a decision");
  const accepted = (value: Parameters<typeof decodePromptAnswer>[1]) =>
    decodePromptAnswer(multiple, value).kind === "accepted";
  expect(accepted({ selected: ["pg", "sqlite"] })).toBe(true);
  expect(accepted({ selected: ["pg", "pg"] })).toBe(false);
  expect(accepted({ selected: ["pg"], text: "and Redis" })).toBe(true);
  expect(accepted({ selected: [] })).toBe(false);
});

it("a decision prompt rejects repeated option values", () => {
  expect(() =>
    parsePrompt({
      type: "decision",
      message: "Which?",
      options: [
        { value: "a", label: "A" },
        { value: "a", label: "B" },
      ],
      other: { label: "Other…", maxLength: 10 },
    }),
  ).toThrow();
});

it("a decision may offer only options, and its Esc and blank answers must be offered", () => {
  const options = [
    { value: "back", label: "Back" },
    { value: "go", label: "Go" },
  ];
  const confirm = parsePrompt({
    type: "decision",
    message: "Sure?",
    options,
    escape: "back",
  });
  if (confirm.type !== "decision") throw new Error("expected a decision");
  const accepted = (value: Parameters<typeof decodePromptAnswer>[1]) =>
    decodePromptAnswer(confirm, value).kind === "accepted";
  expect(accepted({ selected: ["go"] })).toBe(true);
  // With no Other row there is nowhere to write.
  expect(accepted({ selected: [], text: "hm" })).toBe(false);
  expect(() =>
    parsePrompt({ type: "decision", message: "Sure?", options, escape: "no" }),
  ).toThrow();
  expect(() =>
    parsePrompt({
      type: "decision",
      message: "Sure?",
      options,
      other: { label: "Other…", maxLength: 10, blank: "no" },
    }),
  ).toThrow();
  expect(
    parsePrompt({
      type: "decision",
      message: "Sure?",
      options,
      other: { label: "Other…", maxLength: 10, blank: "back" },
    }).type,
  ).toBe("decision");
});
