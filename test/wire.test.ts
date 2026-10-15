import { expect, it } from "vitest";

import {
  createWhistle,
  type WhistleAvailability,
  type WhistleCommandDefinition,
} from "../src/index.js";
import { WhistleAgentProjectionSchema, parse } from "../src/wire.js";

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
