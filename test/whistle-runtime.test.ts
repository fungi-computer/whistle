import { expect, expectTypeOf, it, vi } from "vitest";

import {
  createWhistle,
  WhistleActionError,
  type WhistleAvailability,
  createWhistleKeymapAdapter,
  scopeSnapshot,
  type WhistleCommand,
  type WhistleCommandProjections,
  type WhistleContribution,
  type WhistleAction,
  type WhistleExecutionInput,
  type WhistleExecutionOrigin,
  type WhistleExecutionOutcome,
  type WhistleJsonValue,
  type WhistleSnapshot,
} from "../src/index.js";

it("projects bindings through a host keymap and the Whistle execution door", async () => {
  const handler = vi.fn();
  const runtime = createWhistle();
  const lease = runtime.contribute({
    sourceId: "keyboard-source",
    namespace: "keyboard",
    commands: [
      {
        id: "open",
        title: "Open",
        category: "navigation",
        projections: { bindings: { values: ["ctrl+o"] } },
        handler,
      },
    ],
  });
  let registered:
    | {
        bindings: readonly { cmd?: string; key: unknown }[];
        commands: readonly { name: string; run: () => Promise<boolean> }[];
      }
    | undefined;
  let registeredCount = 0;
  let cleanedCount = 0;
  const keymap = {
    registerLayer: (layer: typeof registered) => {
      registeredCount += 1;
      registered = layer ?? undefined;
      return () => {
        cleanedCount += 1;
      };
    },
  };
  const adapter = createWhistleKeymapAdapter(keymap, runtime, "keyboard");
  expect(registered?.bindings).toEqual([
    { cmd: "keyboard:open", key: "ctrl+o" },
  ]);
  expect(await registered?.commands[0]?.run()).toBe(true);
  expect(handler).toHaveBeenCalledOnce();
  lease.update([
    {
      id: "open",
      title: "Open elsewhere",
      category: "navigation",
      projections: { bindings: { values: ["ctrl+p"] } },
      handler,
    },
  ]);
  expect(registered?.bindings).toEqual([
    { cmd: "keyboard:open", key: "ctrl+p" },
  ]);
  expect(registeredCount).toBe(2);
  expect(cleanedCount).toBe(1);
  adapter.cleanup();
  adapter.cleanup();
  expect(cleanedCount).toBe(2);
});

it("keeps one contribution lease through canonical invocation, update, and disposal", async () => {
  const handler = vi.fn(({ origin }: WhistleExecutionInput) => ({ origin }));
  const runtime = createWhistle();
  const lease = runtime.contribute({
    sourceId: "app-source",
    namespace: "app",
    commands: [
      {
        id: "save",
        title: "Save",
        category: "editor",
        projections: { menu: {} },
        handler,
      },
    ],
  });

  expect(runtime.snapshot().menu[0]?.commandId).toBe("app:save");
  await expect(
    runtime.execute("app:save", { origin: "menu" }),
  ).resolves.toEqual({ status: "handled", result: { origin: "menu" } });
  lease.update([
    {
      id: "save",
      title: "Save file",
      category: "editor",
      projections: { menu: {} },
      handler,
    },
  ]);
  expect(runtime.snapshot().menu[0]?.title).toBe("Save file");
  lease.dispose();
  expect(runtime.snapshot().menu).toEqual([]);
  await expect(
    runtime.execute("app:save", { origin: "menu" }),
  ).resolves.toEqual({ status: "missing" });
});

it("one definition projects binding palette slash help menu and agent rows", () => {
  const handler = vi.fn();
  const runtime = createWhistle();

  runtime.contribute({
    sourceId: "source-a",
    namespace: "demo",
    commands: [
      {
        id: "open",
        title: "Open Thing",
        category: "navigation",
        description: "Open the thing",
        projections: {
          bindings: { values: ["ctrl+o"], order: 11 },
          palette: { order: 12 },
          slash: { aliases: ["open"], order: 13 },
          help: { order: 14 },
          menu: { order: 15 },
          agent: { keybind: "ctrl+o", order: 16 },
        },
        handler,
      },
    ],
  });

  expect(runtime.snapshot().bindings).toEqual([
    {
      commandId: "demo:open",
      availability: { status: "available" },
      sourceId: "source-a",
      title: "Open Thing",
      category: "navigation",
      description: "Open the thing",
      order: 11,
      binding: "ctrl+o",
    },
  ]);
  expect(runtime.snapshot().palette).toEqual([
    {
      commandId: "demo:open",
      availability: { status: "available" },
      sourceId: "source-a",
      title: "Open Thing",
      category: "navigation",
      description: "Open the thing",
      order: 12,
    },
  ]);
  expect(runtime.snapshot().slash).toEqual([
    {
      commandId: "demo:open",
      availability: { status: "available" },
      sourceId: "source-a",
      title: "Open Thing",
      category: "navigation",
      description: "Open the thing",
      order: 13,
      alias: "open",
    },
  ]);
  expect(runtime.snapshot().help).toEqual([
    {
      commandId: "demo:open",
      availability: { status: "available" },
      sourceId: "source-a",
      title: "Open Thing",
      category: "navigation",
      description: "Open the thing",
      order: 14,
    },
  ]);
  expect(runtime.snapshot().menu).toEqual([
    {
      commandId: "demo:open",
      availability: { status: "available" },
      sourceId: "source-a",
      title: "Open Thing",
      category: "navigation",
      description: "Open the thing",
      order: 15,
    },
  ]);
  expect(runtime.snapshot().agent).toEqual([
    {
      commandId: "demo:open",
      availability: { status: "available" },
      sourceId: "source-a",
      title: "Open Thing",
      category: "navigation",
      description: "Open the thing",
      order: 16,
      keybind: "ctrl+o",
    },
  ]);
  expect(handler).not.toHaveBeenCalled();
});

it("keeps unavailable actions discoverable and rechecks before dispatch", async () => {
  const runtime = createWhistle();
  let availability: WhistleAvailability = { status: "available" };
  const handler = vi.fn(() => ({ receipt: "saved" }));
  runtime.contribute({
    sourceId: "owner",
    namespace: "policy",
    commands: [
      {
        id: "save",
        title: "Save policy",
        category: "policy",
        availability: () => availability,
        projections: { agent: {}, menu: {}, bindings: { values: ["ctrl+s"] } },
        handler,
      },
    ],
  });
  const before = runtime.snapshot();
  expect(runtime.snapshot()).toBe(before);
  availability = { status: "unavailable", reason: "Policy is locked" };
  await expect(
    runtime.execute("policy:save", { origin: "agent" }),
  ).resolves.toEqual(availability);
  expect(handler).not.toHaveBeenCalled();
  const after = runtime.snapshot();
  expect(after.agent[0]?.availability).toEqual(availability);
  expect(after.menu[0]?.availability).toEqual(availability);
  expect(after.bindings[0]?.availability).toEqual(availability);
  expect(before.agent[0]?.availability).toEqual({ status: "available" });
  expect(runtime.snapshot()).toBe(after);
  availability = { status: "available" };
  await expect(
    runtime.execute("policy:save", { origin: "keyboard" }),
  ).resolves.toEqual({
    status: "handled",
    result: { receipt: "saved" },
  });
  expect(handler).toHaveBeenCalledOnce();
});

it("keeps custom acquisition data local while exposing the same semantic action", () => {
  const runtime = createWhistle();
  const inputSchema = {
    type: "object",
    properties: { area: { type: "object" } },
  };
  const data = { fields: { area: { gesture: "rectangle" } }, persistent: true };
  runtime.contribute({
    sourceId: "client",
    namespace: "policy",
    commands: [
      {
        id: "save",
        title: "Save",
        category: "policy",
        action: { inputSchema, presentation: { type: "custom", data } },
        projections: { agent: {}, menu: {} },
        handler: () => undefined,
      },
    ],
  });
  const snapshot = runtime.snapshot();
  expect(snapshot.menu[0]?.action?.presentation).toEqual({
    type: "custom",
    data,
  });
  expect(snapshot.agent[0]?.action).toEqual({ inputSchema });
  data.fields.area.gesture = "point";
  expect(snapshot.menu[0]?.action?.presentation).toMatchObject({
    data: { fields: { area: { gesture: "rectangle" } } },
  });
});

it("returns explicit failures as JSON data while preserving domain receipts", async () => {
  const runtime = createWhistle();
  runtime.contribute({
    sourceId: "owner",
    namespace: "policy",
    commands: [
      {
        id: "save",
        title: "Save policy",
        category: "policy",
        handler: () => {
          throw new WhistleActionError("revision_conflict", "Policy changed", {
            revision: 2,
          });
        },
      },
    ],
  });
  const outcome = await runtime.execute("policy:save", { origin: "agent" });
  expect(JSON.parse(JSON.stringify(outcome))).toEqual({
    status: "failed",
    error: {
      code: "revision_conflict",
      message: "Policy changed",
      details: { revision: 2 },
    },
  });
});

it("dispatches typed action arguments and returns its typed result", async () => {
  type Arguments = Readonly<{ modelId: string; reasoning: "low" | "high" }>;
  type Result = Readonly<{ selected: string }>;
  const handler = vi.fn(
    ({ arguments: input }: WhistleExecutionInput<Arguments>): Result => {
      if (input === undefined) throw new Error("Missing model arguments");
      return { selected: `${input.modelId}:${input.reasoning}` };
    },
  );
  const runtime = createWhistle();
  runtime.contribute({
    sourceId: "model-source",
    namespace: "model",
    commands: [
      {
        id: "select",
        title: "Select model",
        category: "model",
        action: {
          inputSchema: {
            type: "object",
            properties: {
              modelId: { type: "string" },
              reasoning: { enum: ["low", "high"] },
            },
            required: ["modelId", "reasoning"],
          },
          outputSchema: {
            type: "object",
            properties: { selected: { type: "string" } },
          },
          presentation: {
            type: "choice",
            options: [
              {
                value: { modelId: "gpt-5.6-luna", reasoning: "low" },
                label: "Luna · low",
              },
            ],
          },
        },
        handler,
      } satisfies WhistleCommand<Arguments, Result>,
    ],
  });

  await expect(
    runtime.execute("model:select", {
      origin: "programmatic",
      arguments: { modelId: "gpt-5.6-luna", reasoning: "low" },
    }),
  ).resolves.toEqual({
    status: "handled",
    result: { selected: "gpt-5.6-luna:low" },
  });
  expect(handler).toHaveBeenCalledWith(
    expect.objectContaining({
      origin: "programmatic",
      arguments: { modelId: "gpt-5.6-luna", reasoning: "low" },
    }),
  );
});

it("reuses the public handler contract in heterogeneous contributions", async () => {
  type Arguments = Readonly<{ modelId: string; reasoning: "low" | "high" }>;
  type Result = Readonly<{ selected: string }>;
  type Handler = WhistleCommand<Arguments, Result>["handler"];

  const selectModel: Handler = ({ arguments: input }) =>
    input === undefined
      ? undefined
      : { selected: `${input.modelId}:${input.reasoning}` };
  const increment: WhistleCommand<{ count: number }, number>["handler"] = ({
    arguments: input,
  }) => Promise.resolve(input === undefined ? undefined : input.count + 1);

  expectTypeOf<Parameters<Handler>>().toEqualTypeOf<
    [WhistleExecutionInput<Arguments>]
  >();
  expectTypeOf<ReturnType<Handler>>().toEqualTypeOf<
    Result | undefined | Promise<Result | undefined>
  >();
  expectTypeOf<
    (input: WhistleExecutionInput<{ modelId: number }>) => Result
  >().not.toExtend<Handler>();
  expectTypeOf<
    (input: WhistleExecutionInput<Arguments>) => { selected: number }
  >().not.toExtend<Handler>();
  expectTypeOf<
    (input: WhistleExecutionInput<Arguments>) => Promise<{ selected: number }>
  >().not.toExtend<Handler>();

  const commands: readonly WhistleCommand<never>[] = [
    {
      id: "select",
      title: "Select model",
      category: "model",
      handler: selectModel,
    } satisfies WhistleCommand<Arguments, Result>,
    {
      id: "select-again",
      title: "Select model again",
      category: "model",
      handler: selectModel,
    } satisfies WhistleCommand<Arguments, Result>,
    {
      id: "increment",
      title: "Increment",
      category: "counter",
      handler: increment,
    } satisfies WhistleCommand<{ count: number }, number>,
  ];
  const runtime = createWhistle();
  runtime.contribute({
    sourceId: "reusable-handlers",
    namespace: "host",
    commands,
  });

  for (const commandId of ["host:select", "host:select-again"])
    await expect(
      runtime.execute(commandId, {
        origin: "programmatic",
        arguments: { modelId: "luna", reasoning: "low" },
      }),
    ).resolves.toEqual({
      status: "handled",
      result: { selected: "luna:low" },
    });
  await expect(
    runtime.execute("host:increment", {
      origin: "programmatic",
      arguments: { count: 2 },
    }),
  ).resolves.toEqual({ status: "handled", result: 3 });
  await expect(
    runtime.execute("host:select", { origin: "programmatic" }),
  ).resolves.toEqual({ status: "handled" });
});

it("projects declarative action presentation and preserves its immutable schema", () => {
  const options = [
    {
      value: { reasoning: "low" },
      label: "Low",
      description: "Use fewer tokens",
    },
    { value: { reasoning: "high" }, label: "High" },
  ];
  const schema = {
    type: "object",
    properties: { reasoning: { type: "string", enum: ["low", "high"] } },
    required: ["reasoning"],
  };
  const action: WhistleAction = {
    inputSchema: schema,
    outputSchema: {
      type: "object",
      properties: { selected: { type: "string" } },
    },
    presentation: { type: "choice", options },
  };
  const runtime = createWhistle();
  runtime.contribute({
    sourceId: "model-source",
    namespace: "model",
    commands: [
      {
        id: "select",
        title: "Select model",
        category: "model",
        action,
        handler: () => ({ selected: "low" }),
        projections: { palette: {}, menu: {}, agent: {} },
      },
    ],
  });

  const rows = runtime.snapshot();
  expect(rows.palette[0]?.action).toEqual(action);
  expect(rows.menu[0]?.action?.presentation).toEqual({
    type: "choice",
    options,
  });
  expect(rows.agent[0]?.action?.inputSchema).toEqual(schema);
  expect(Object.isFrozen(rows.palette[0]?.action)).toBe(true);
  expect(Object.isFrozen(rows.palette[0]?.action?.inputSchema)).toBe(true);
  expect(Object.isFrozen(rows.palette[0]?.action?.presentation)).toBe(true);
  const presentation = rows.palette[0]?.action?.presentation;
  expect(presentation?.type).toBe("choice");
  if (presentation?.type === "choice")
    expect(Object.isFrozen(presentation.options)).toBe(true);
  if (presentation?.type === "choice")
    expect(Object.isFrozen(presentation.options[0]?.value)).toBe(true);
  expect(() => {
    // SAFETY: this test mutates the caller-owned fixture after contribution to
    // prove Whistle retained an independent schema copy.
    (schema.properties as { reasoning: unknown }).reasoning = {
      type: "number",
    };
  }).not.toThrow();
  const firstChoice = options[0];
  if (firstChoice === undefined) throw new Error("Missing choice fixture");
  expect(() => {
    // SAFETY: the fixture is the mutable producer-side value; Whistle's
    // projected choice value is already a copied JSON object.
    firstChoice.value.reasoning = "high";
  }).not.toThrow();
  expect(rows.palette[0]?.action?.inputSchema).toEqual({
    type: "object",
    properties: { reasoning: { type: "string", enum: ["low", "high"] } },
    required: ["reasoning"],
  });
  expect(rows.palette[0]?.action?.presentation).toEqual({
    type: "choice",
    options: [
      {
        value: { reasoning: "low" },
        label: "Low",
        description: "Use fewer tokens",
      },
      { value: { reasoning: "high" }, label: "High" },
    ],
  });
});

it("accepts ordinary, form, and confirmation presentation hints without owning rendering", () => {
  const runtime = createWhistle();
  runtime.contribute({
    sourceId: "presentation-source",
    namespace: "present",
    commands: [
      {
        id: "ordinary",
        title: "Ordinary",
        category: "action",
        action: { presentation: { type: "action" } },
        handler: () => undefined,
        projections: { palette: {} },
      },
      {
        id: "form",
        title: "Form",
        category: "action",
        action: { presentation: { type: "form", submitLabel: "Apply" } },
        handler: () => undefined,
        projections: { palette: {} },
      },
      {
        id: "confirm",
        title: "Confirm",
        category: "action",
        action: {
          presentation: {
            type: "confirmation",
            message: "Apply this model?",
            confirmLabel: "Apply",
            cancelLabel: "Keep current",
          },
        },
        handler: () => undefined,
        projections: { palette: {} },
      },
    ],
  });
  expect(
    runtime.snapshot().palette.map((row) => row.action?.presentation),
  ).toEqual([
    {
      type: "confirmation",
      message: "Apply this model?",
      confirmLabel: "Apply",
      cancelLabel: "Keep current",
    },
    { type: "form", submitLabel: "Apply" },
    { type: "action" },
  ]);
});

type ProjectionOptions = Readonly<{
  bindingValues?: readonly string[];
  slashAliases?: readonly string[];
  keybind?: string;
  order?: number;
}>;

function projections(
  options: ProjectionOptions = {},
): WhistleCommandProjections {
  const order = options.order ?? 0;
  return {
    bindings: { values: options.bindingValues ?? ["ctrl+o"], order },
    palette: { order },
    slash: { aliases: options.slashAliases ?? ["open"], order },
    help: { order },
    menu: { order },
    agent: { keybind: options.keybind ?? "ctrl+o", order },
  };
}

type CommandOptions = Readonly<{
  id?: string;
  title?: string;
  category?: string;
  projections?: WhistleCommandProjections;
}>;

function command(options: CommandOptions = {}): WhistleCommand {
  return {
    id: options.id ?? "open",
    title: options.title ?? "Open",
    category: options.category ?? "navigation",
    description: "Open the thing",
    projections: options.projections ?? projections(),
    handler: () => undefined,
  };
}

type ContributionOptions = Readonly<{
  sourceId?: string;
  namespace?: string;
  commands?: readonly WhistleCommand[];
}>;

function contribution(options: ContributionOptions = {}): WhistleContribution {
  return {
    sourceId: options.sourceId ?? "source",
    namespace: options.namespace ?? "demo",
    commands: options.commands ?? [command()],
  };
}

it("semantic identity metadata and projection labels stay meaningful and atomic", () => {
  const meaningful = contribution({
    sourceId: "Source:Δ",
    namespace: "Nämé",
    commands: [
      {
        id: "Löcal",
        title: "Öpen Δ",
        category: "Nävigation",
        description: "",
        projections: {
          bindings: {
            values: Array.from({ length: 16 }, (_, index) =>
              index === 0 ? "⌘Ö" : `Bind${String(index)}`,
            ),
            order: Number.MAX_SAFE_INTEGER,
          },
          palette: { order: Number.MAX_SAFE_INTEGER },
          slash: {
            aliases: Array.from({ length: 16 }, (_, index) =>
              index === 0 ? "Älias" : `Alias${String(index)}`,
            ),
            order: Number.MAX_SAFE_INTEGER,
          },
          help: { order: Number.MAX_SAFE_INTEGER },
          menu: { order: Number.MAX_SAFE_INTEGER },
          agent: { keybind: "Kéy", order: Number.MAX_SAFE_INTEGER },
        },
        handler: () => undefined,
      },
    ],
  });
  const acceptedRuntime = createWhistle();
  expect(() => acceptedRuntime.contribute(meaningful)).not.toThrow();

  const rejected: readonly WhistleContribution[] = [
    contribution({ sourceId: "   " }),
    contribution({ namespace: "   " }),
    contribution({ namespace: "a:b" }),
    contribution({ commands: [command({ id: "   " })] }),
    contribution({ commands: [command({ id: "a:b" })] }),
    contribution({ commands: [command({ title: "   " })] }),
    contribution({ commands: [command({ category: "   " })] }),
    contribution({
      commands: [
        command({ projections: projections({ bindingValues: ["   "] }) }),
      ],
    }),
    contribution({
      commands: [
        command({ projections: projections({ slashAliases: ["   "] }) }),
      ],
    }),
    contribution({
      commands: [command({ projections: projections({ keybind: "   " }) })],
    }),
    ...[
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ].map((order) =>
      contribution({
        commands: [command({ projections: projections({ order }) })],
      }),
    ),
    contribution({
      commands: [
        command({
          projections: projections({
            bindingValues: Array.from(
              { length: 17 },
              (_, index) => `b${String(index)}`,
            ),
          }),
        }),
      ],
    }),
    contribution({
      commands: [
        command({
          projections: projections({
            slashAliases: Array.from(
              { length: 17 },
              (_, index) => `a${String(index)}`,
            ),
          }),
        }),
      ],
    }),
  ];

  for (const candidate of rejected) {
    const runtime = createWhistle();
    runtime.contribute(
      contribution({ sourceId: "seed-source", namespace: "seed" }),
    );
    const before = runtime.snapshot();
    expect(() => runtime.contribute(candidate)).toThrow();
    expect(runtime.snapshot()).toEqual(before);
  }
});

it("duplicate identities namespaces and slash aliases reject without partial registration", () => {
  const seed = contribution({
    sourceId: "seed-source",
    namespace: "demo",
    commands: [
      command({
        id: "seed",
        projections: projections({ slashAliases: ["shared"] }),
      }),
    ],
  });
  const expectConflict = (
    candidate: WhistleContribution,
    initial: WhistleContribution = seed,
  ): void => {
    const runtime = createWhistle();
    runtime.contribute(initial);
    const before = runtime.snapshot();
    expect(() => runtime.contribute(candidate)).toThrow();
    expect(runtime.snapshot()).toEqual(before);
  };

  expectConflict(
    contribution({
      sourceId: "new-source",
      namespace: "new",
      commands: [
        command({ id: "same" }),
        command({ id: "same" }),
        command({ id: "tail" }),
      ],
    }),
    contribution({ sourceId: "seed-source", namespace: "seed", commands: [] }),
  );
  expectConflict(
    contribution({
      sourceId: "seed-source",
      commands: [command({ id: "seed" }), command({ id: "tail" })],
    }),
  );
  expectConflict(
    contribution({
      sourceId: "other-source",
      commands: [command({ id: "other" }), command({ id: "tail" })],
    }),
  );
  expectConflict(
    contribution({
      sourceId: "new-source",
      namespace: "new",
      commands: [
        command({
          id: "first",
          projections: projections({ slashAliases: ["shared"] }),
        }),
        command({
          id: "second",
          projections: projections({ slashAliases: ["shared"] }),
        }),
        command({ id: "tail" }),
      ],
    }),
    contribution({ sourceId: "seed-source", namespace: "seed", commands: [] }),
  );
  expectConflict(
    contribution({
      sourceId: "seed-source",
      commands: [
        command({
          id: "other",
          projections: projections({ slashAliases: ["shared"] }),
        }),
        command({ id: "tail" }),
      ],
    }),
  );

  const equalBindings = createWhistle();
  equalBindings.contribute(
    contribution({
      sourceId: "shared-source",
      namespace: "shared",
      commands: [
        command({
          id: "first",
          projections: { bindings: { values: ["ctrl+x"] } },
        }),
      ],
    }),
  );
  equalBindings.contribute(
    contribution({
      sourceId: "shared-source",
      namespace: "shared",
      commands: [
        command({
          id: "second",
          projections: { bindings: { values: ["ctrl+x"] } },
        }),
      ],
    }),
  );
  expect(
    equalBindings
      .snapshot()
      .bindings.map((row) => [row.commandId, row.binding]),
  ).toEqual([
    ["shared:first", "ctrl+x"],
    ["shared:second", "ctrl+x"],
  ]);

  const emptyRuntime = createWhistle();
  const emptyBefore = emptyRuntime.snapshot();
  const emptyLease = emptyRuntime.contribute(
    contribution({
      sourceId: "empty-source",
      namespace: "empty",
      commands: [],
    }),
  );
  expect(emptyRuntime.snapshot()).toEqual(emptyBefore);
  emptyLease.dispose();
  emptyLease.dispose();
  emptyRuntime.contribute(
    contribution({
      sourceId: "other-source",
      namespace: "empty",
      commands: [command({ id: "other", projections: { palette: {} } })],
    }),
  );
  expect(emptyRuntime.snapshot().palette.map((row) => row.commandId)).toEqual([
    "empty:other",
  ]);
  emptyLease.dispose();
  expect(emptyRuntime.snapshot().palette.map((row) => row.commandId)).toEqual([
    "empty:other",
  ]);
});

it("a lease disposes only the generation it registered", () => {
  const runtime = createWhistle();
  const firstLease = runtime.contribute(
    contribution({
      sourceId: "first-source",
      commands: [
        command({ id: "open", projections: { palette: { order: 0 } } }),
      ],
    }),
  );
  firstLease.dispose();
  firstLease.dispose();
  expect(runtime.snapshot().palette).toEqual([]);

  const replacementLease = runtime.contribute(
    contribution({
      sourceId: "replacement-source",
      commands: [
        command({ id: "open", projections: { palette: { order: 0 } } }),
      ],
    }),
  );
  const replacementSnapshot = runtime.snapshot();
  firstLease.dispose();
  expect(runtime.snapshot()).toEqual(replacementSnapshot);
  replacementLease.dispose();
  replacementLease.dispose();
  expect(runtime.snapshot().palette).toEqual([]);
});

it("atomically updates one leased generation and publishes one coherent snapshot", () => {
  const runtime = createWhistle();
  const lease = runtime.contribute(
    contribution({
      sourceId: "changing-source",
      namespace: "changing",
      commands: [orderedCommand("before", 1, ["ctrl+b"], ["before"])],
    }),
  );
  const observed: WhistleSnapshot[] = [];
  const unsubscribe = runtime.subscribe(() => {
    observed.push(runtime.snapshot());
  });

  lease.update([orderedCommand("after", 2, ["ctrl+a"], ["after"])]);

  expect(observed).toHaveLength(1);
  for (const rows of Object.values(observed[0] ?? {})) {
    expect(rows.map((row) => row.commandId)).toEqual(["changing:after"]);
  }

  runtime.contribute(
    contribution({
      sourceId: "reserved-source",
      namespace: "reserved",
      commands: [
        command({
          id: "reserved",
          projections: { slash: { aliases: ["reserved"] } },
        }),
      ],
    }),
  );
  const beforeInvalid = runtime.snapshot();
  const notificationCount = observed.length;
  expect(() => {
    lease.update([orderedCommand("invalid", 3, ["ctrl+i"], ["reserved"])]);
  }).toThrow("Slash alias is already registered");
  expect(runtime.snapshot()).toBe(beforeInvalid);
  expect(observed).toHaveLength(notificationCount);

  unsubscribe();
  lease.dispose();
  expect(observed).toHaveLength(notificationCount);
});

it("a disposed lease cannot update a successor generation", () => {
  const runtime = createWhistle();
  const retired = runtime.contribute(
    contribution({
      sourceId: "same-source",
      namespace: "same",
      commands: [command({ id: "first", projections: { palette: {} } })],
    }),
  );
  retired.dispose();
  const successor = runtime.contribute(
    contribution({
      sourceId: "same-source",
      namespace: "same",
      commands: [command({ id: "second", projections: { palette: {} } })],
    }),
  );
  retired.update([command({ id: "stale", projections: { palette: {} } })]);
  expect(runtime.snapshot().palette.map((row) => row.commandId)).toEqual([
    "same:second",
  ]);
  successor.dispose();
});

function orderedCommand(
  id: string,
  order: number,
  bindingValues: string[],
  slashAliases: string[],
) {
  return {
    id,
    title: `Title ${id}`,
    category: "commands",
    description: `Description ${id}`,
    projections: {
      bindings: { values: bindingValues, order },
      palette: { order },
      slash: { aliases: slashAliases, order },
      help: { order },
      menu: { order },
      agent: { keybind: `key-${id}`, order },
    },
    handler: () => undefined,
  };
}

function orderedContribution(
  sourceId: string,
  namespace: string,
  commands: ReturnType<typeof orderedCommand>[],
) {
  return { sourceId, namespace, commands };
}

it("snapshot order and bytes stay deterministic and immutable across caller mutation", () => {
  const alphaZetaBindings = ["z-binding", "a-binding"];
  const alphaZetaAliases = ["zeta-z", "zeta-a"];
  const alphaAlphaBindings = ["d-binding", "c-binding"];
  const alphaAlphaAliases = ["alpha-d", "alpha-c"];
  const betaGammaBindings = ["z-gamma", "a-gamma"];
  const betaGammaAliases = ["gamma-z", "gamma-a"];
  const betaBetaBindings = ["d-beta", "c-beta"];
  const betaBetaAliases = ["beta-d", "beta-c"];

  const alpha = orderedContribution("source-alpha", "alpha", [
    orderedCommand("zeta", 1, alphaZetaBindings, alphaZetaAliases),
    orderedCommand("alpha", 2, alphaAlphaBindings, alphaAlphaAliases),
  ]);
  const beta = orderedContribution("source-beta", "beta", [
    orderedCommand("gamma", 1, betaGammaBindings, betaGammaAliases),
    orderedCommand("beta", 2, betaBetaBindings, betaBetaAliases),
  ]);
  const firstRuntime = createWhistle();
  firstRuntime.contribute(alpha);
  firstRuntime.contribute(beta);
  const prior = firstRuntime.snapshot();
  const priorBytes = JSON.stringify(prior);

  const secondRuntime = createWhistle();
  secondRuntime.contribute(
    orderedContribution("source-beta", "beta", [
      orderedCommand(
        "beta",
        2,
        [...betaBetaBindings].reverse(),
        [...betaBetaAliases].reverse(),
      ),
      orderedCommand(
        "gamma",
        1,
        [...betaGammaBindings].reverse(),
        [...betaGammaAliases].reverse(),
      ),
    ]),
  );
  secondRuntime.contribute(
    orderedContribution("source-alpha", "alpha", [
      orderedCommand(
        "alpha",
        2,
        [...alphaAlphaBindings].reverse(),
        [...alphaAlphaAliases].reverse(),
      ),
      orderedCommand(
        "zeta",
        1,
        [...alphaZetaBindings].reverse(),
        [...alphaZetaAliases].reverse(),
      ),
    ]),
  );
  expect(JSON.stringify(secondRuntime.snapshot())).toBe(priorBytes);

  const orderedIds = ["alpha:zeta", "beta:gamma", "alpha:alpha", "beta:beta"];
  for (const rows of [prior.palette, prior.help, prior.menu, prior.agent])
    expect(rows.map((row) => row.commandId)).toEqual(orderedIds);
  expect(
    prior.bindings.map((row) => `${row.commandId}:${row.binding}`),
  ).toEqual([
    "alpha:zeta:a-binding",
    "alpha:zeta:z-binding",
    "beta:gamma:a-gamma",
    "beta:gamma:z-gamma",
    "alpha:alpha:c-binding",
    "alpha:alpha:d-binding",
    "beta:beta:c-beta",
    "beta:beta:d-beta",
  ]);
  expect(prior.slash.map((row) => `${row.commandId}:${row.alias}`)).toEqual([
    "alpha:zeta:zeta-a",
    "alpha:zeta:zeta-z",
    "beta:gamma:gamma-a",
    "beta:gamma:gamma-z",
    "alpha:alpha:alpha-c",
    "alpha:alpha:alpha-d",
    "beta:beta:beta-c",
    "beta:beta:beta-d",
  ]);

  const utf8Runtime = createWhistle();
  utf8Runtime.contribute({
    sourceId: "utf8-source",
    namespace: "utf8",
    commands: [
      orderedCommand("\uE000", 0, ["binding-e"], ["alias-e"]),
      orderedCommand("\u{10000}", 0, ["binding-u"], ["alias-u"]),
      orderedCommand(
        "tie",
        0,
        ["\u{10000}-tie", "\uE000-tie"],
        ["\u{10000}-alias", "\uE000-alias"],
      ),
    ],
  });
  const utf8Snapshot = utf8Runtime.snapshot();
  expect({
    ids: utf8Snapshot.palette.map((row) => row.commandId),
    bindings: utf8Snapshot.bindings.map(
      (row) => `${row.commandId}:${row.binding}`,
    ),
    aliases: utf8Snapshot.slash.map((row) => `${row.commandId}:${row.alias}`),
  }).toEqual({
    ids: ["utf8:tie", "utf8:\uE000", "utf8:\u{10000}"],
    bindings: [
      "utf8:tie:\uE000-tie",
      "utf8:tie:\u{10000}-tie",
      "utf8:\uE000:binding-e",
      "utf8:\u{10000}:binding-u",
    ],
    aliases: [
      "utf8:tie:\uE000-alias",
      "utf8:tie:\u{10000}-alias",
      "utf8:\uE000:alias-e",
      "utf8:\u{10000}:alias-u",
    ],
  });

  const laterLease = firstRuntime.contribute(
    orderedContribution("later-source", "later", [
      orderedCommand("late", 3, ["binding-late"], ["alias-late"]),
    ]),
  );
  const current = firstRuntime.snapshot();
  const currentBytes = JSON.stringify(current);
  expect(current.palette.map((row) => row.commandId)).toEqual([
    ...orderedIds,
    "later:late",
  ]);

  alpha.sourceId = "mutated-source";
  alpha.namespace = "mutated-namespace";
  const mutableAlpha = alpha.commands[0];
  if (mutableAlpha === undefined) throw new Error("missing alpha fixture");
  mutableAlpha.id = "mutated-id";
  mutableAlpha.title = "Mutated title";
  mutableAlpha.projections.bindings.order = 999;
  alphaZetaBindings[0] = "mutated-binding";
  alphaZetaAliases[0] = "mutated-alias";
  expect(JSON.stringify(prior)).toBe(priorBytes);
  expect(JSON.stringify(current)).toBe(currentBytes);

  for (const snapshot of [prior, current]) expectDeeplyFrozen(snapshot);
  laterLease.dispose();
});

it("forwards the caller signal and isolates concurrent invocation aborts", async () => {
  const controllers = {
    first: new AbortController(),
    second: new AbortController(),
  };
  const resolvers = new Map<
    "first" | "second",
    (value: WhistleJsonValue) => void
  >();
  const seenSignals = new Map<string, AbortSignal>();
  const runtime = createWhistle();
  runtime.contribute({
    sourceId: "abort-source",
    namespace: "abort",
    commands: [
      {
        id: "run",
        title: "Run",
        category: "execution",
        handler: (input: WhistleExecutionInput<{ id: "first" | "second" }>) =>
          new Promise<WhistleJsonValue>((resolve) => {
            const id = input.arguments?.id;
            if (!id || !input.signal)
              throw new Error("missing invocation data");
            seenSignals.set(id, input.signal);
            input.signal.addEventListener(
              "abort",
              () => {
                resolve({ id, aborted: true });
              },
              { once: true },
            );
            resolvers.set(id, resolve);
          }),
      },
    ],
  });

  const first = runtime.execute("abort:run", {
    origin: "programmatic",
    arguments: { id: "first" },
    signal: controllers.first.signal,
  });
  const second = runtime.execute("abort:run", {
    origin: "programmatic",
    arguments: { id: "second" },
    signal: controllers.second.signal,
  });
  await Promise.resolve();
  expect(seenSignals.get("first")).toBe(controllers.first.signal);
  expect(seenSignals.get("second")).toBe(controllers.second.signal);

  controllers.first.abort();
  await expect(first).resolves.toEqual({
    status: "handled",
    result: { id: "first", aborted: true },
  });
  expect(resolvers.has("second")).toBe(true);
  resolvers.get("second")?.({ id: "second" });
  await expect(second).resolves.toEqual({
    status: "handled",
    result: { id: "second" },
  });
  expect(controllers.second.signal.aborted).toBe(false);
});

function expectDeeplyFrozen(snapshot: WhistleSnapshot): void {
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(() => Object.assign(snapshot, { palette: [] })).toThrow(TypeError);
  for (const rows of [
    snapshot.bindings,
    snapshot.palette,
    snapshot.slash,
    snapshot.help,
    snapshot.menu,
    snapshot.agent,
  ]) {
    expect(Object.isFrozen(rows)).toBe(true);
    expect(() => Object.assign(rows, { length: 0 })).toThrow(TypeError);
    for (const row of rows) {
      expect(Object.isFrozen(row)).toBe(true);
      expect(() => Object.assign(row, { commandId: "mutated" })).toThrow(
        TypeError,
      );
    }
  }
}

it("live graph ceilings accept maxima and reject overflow atomically", () => {
  const paletteContribution = (
    sourceId: string,
    namespace: string,
    ids: readonly string[] = ["command"],
  ): WhistleContribution =>
    contribution({
      sourceId,
      namespace,
      commands: ids.map((id) => command({ id, projections: { palette: {} } })),
    });

  const contributionRuntime = createWhistle();
  const leases = Array.from({ length: 64 }, (_, index) =>
    contributionRuntime.contribute(
      paletteContribution(
        `source-${String(index)}`,
        `namespace-${String(index)}`,
      ),
    ),
  );
  expect(contributionRuntime.snapshot().palette).toHaveLength(64);
  const beforeContributionOverflow = contributionRuntime.snapshot();
  expect(() =>
    contributionRuntime.contribute(
      paletteContribution("overflow-source", "overflow-namespace"),
    ),
  ).toThrow();
  expect(contributionRuntime.snapshot()).toEqual(beforeContributionOverflow);

  const firstLease = leases[0];
  if (firstLease === undefined) throw new Error("missing contribution lease");
  firstLease.dispose();
  contributionRuntime.contribute(
    paletteContribution("replacement-source", "replacement-namespace"),
  );
  expect(contributionRuntime.snapshot().palette).toHaveLength(64);

  const commandRuntime = createWhistle();
  const largeLease = commandRuntime.contribute(
    paletteContribution(
      "commands-source",
      "commands-namespace",
      Array.from({ length: 256 }, (_, index) => `command-${String(index)}`),
    ),
  );
  expect(commandRuntime.snapshot().palette).toHaveLength(256);
  const beforeCommandOverflow = commandRuntime.snapshot();
  expect(() =>
    commandRuntime.contribute(
      paletteContribution("extra-source", "extra-namespace", ["extra"]),
    ),
  ).toThrow();
  expect(commandRuntime.snapshot()).toEqual(beforeCommandOverflow);

  largeLease.dispose();
  expect(commandRuntime.snapshot().palette).toEqual([]);
  commandRuntime.contribute(
    paletteContribution("replacement-source", "replacement-namespace"),
  );
  expect(commandRuntime.snapshot().palette).toHaveLength(1);
});

it("every origin uses one door with normalized in-scope execution outcomes", async () => {
  const origins = [
    "agent",
    "browser",
    "keyboard",
    "menu",
    "palette",
    "programmatic",
    "slash",
    "terminal",
  ] as const satisfies readonly WhistleExecutionOrigin[];
  const failure = new Error("terminal handler failed");
  const handler = vi.fn((input: WhistleExecutionInput) => {
    if (input.origin === "terminal") throw failure;
    if (input.origin === "browser") return Promise.resolve();
    return undefined;
  });
  const runtime = createWhistle();
  runtime.contribute({
    sourceId: "execution-source",
    namespace: "demo",
    commands: [
      {
        id: "run",
        title: "Run",
        category: "execution",
        handler,
      },
    ],
  });

  expect(runtime.execute).toBeTypeOf("function");

  const outcomes = new Map<WhistleExecutionOrigin, WhistleExecutionOutcome>();
  for (const origin of origins)
    outcomes.set(origin, await runtime.execute("demo:run", { origin }));

  expect(
    Object.fromEntries(
      [...outcomes].map(([origin, outcome]) => [origin, outcome.status]),
    ),
  ).toEqual({
    agent: "handled",
    browser: "handled",
    keyboard: "handled",
    menu: "handled",
    palette: "handled",
    programmatic: "handled",
    slash: "handled",
    terminal: "failed",
  });
  expect(outcomes.get("terminal")).toEqual({
    status: "failed",
    error: { code: "command_failed", message: failure.message },
  });
  expect(handler).toHaveBeenCalledTimes(origins.length);
  for (const origin of origins)
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ origin }));

  expect(
    await runtime.execute("demo:absent", { origin: "programmatic" }),
  ).toEqual({ status: "missing" });
  expect(await runtime.execute("   ", { origin: "programmatic" })).toEqual({
    status: "invalid",
  });
  expect(handler).toHaveBeenCalledTimes(origins.length);
});

it("close releases the graph without background work", async () => {
  let resolveHandler: (() => void) | undefined;
  const handler = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveHandler = resolve;
      }),
  );
  const runtime = createWhistle();
  const lease = runtime.contribute(
    contribution({
      commands: [
        {
          ...command({ id: "run", projections: { palette: {} } }),
          handler,
        },
      ],
    }),
  );
  const beforeClose = runtime.snapshot();
  const beforeCloseBytes = JSON.stringify(beforeClose);
  const runningExecution = runtime.execute("demo:run", {
    origin: "programmatic",
  });

  expect(runtime.close).toBeTypeOf("function");

  const { WhistleClosedError } = await import("../src/index.js");
  expect(handler).toHaveBeenCalledOnce();
  if (resolveHandler === undefined) throw new Error("handler did not start");

  expectTypeOf(runtime.close).returns.toEqualTypeOf<undefined>();
  runtime.close();
  const closedSnapshot = runtime.snapshot();
  expect(closedSnapshot).toEqual({
    bindings: [],
    palette: [],
    slash: [],
    help: [],
    menu: [],
    agent: [],
  });
  expectDeeplyFrozen(closedSnapshot);
  expect(runtime.snapshot()).toBe(closedSnapshot);
  runtime.close();
  expect(runtime.snapshot()).toBe(closedSnapshot);

  expect(JSON.stringify(beforeClose)).toBe(beforeCloseBytes);
  expect(beforeClose.palette.map((row) => row.commandId)).toEqual(["demo:run"]);
  expectDeeplyFrozen(beforeClose);

  lease.dispose();
  expect(runtime.snapshot()).toBe(closedSnapshot);

  await expect(
    runtime.execute("demo:run", { origin: "programmatic" }),
  ).resolves.toEqual({ status: "closed" });
  expect(handler).toHaveBeenCalledOnce();

  expect(() =>
    runtime.contribute(
      contribution({
        sourceId: "later-source",
        namespace: "later",
        commands: [command({ projections: { palette: {} } })],
      }),
    ),
  ).toThrow(WhistleClosedError);
  expect(runtime.snapshot()).toBe(closedSnapshot);

  resolveHandler();
  await expect(runningExecution).resolves.toEqual({ status: "handled" });
});

it("scopes slash aliases per focus scope and lets the focused scope shadow global rows", async () => {
  const runtime = createWhistle();
  const scoped = (scope: string, alias: string, key: string) => ({
    sourceId: scope,
    namespace: scope,
    scope,
    commands: [
      command({
        id: "new",
        projections: {
          slash: { aliases: [alias] },
          bindings: { values: [key] },
          palette: {},
          agent: {},
        },
      }),
    ],
  });
  runtime.contribute({
    sourceId: "shell",
    namespace: "shell",
    commands: [
      command({
        id: "help",
        projections: {
          slash: { aliases: ["help", "new"] },
          bindings: { values: ["ctrl+n"] },
          palette: {},
        },
      }),
    ],
  });
  runtime.contribute(scoped("first-window", "new", "ctrl+n"));
  runtime.contribute(scoped("second-window", "new", "ctrl+n"));
  expect(() =>
    runtime.contribute({
      ...scoped("first-window", "new", "ctrl+x"),
      namespace: "again",
    }),
  ).toThrow("Slash alias is already registered");
  expect(() =>
    runtime.contribute(
      contribution({
        sourceId: "other",
        namespace: "other",
        commands: [
          command({ id: "x", projections: { slash: { aliases: ["help"] } } }),
        ],
      }),
    ),
  ).toThrow("Slash alias is already registered");

  const full = runtime.snapshot();
  expect(full.slash.filter((row) => row.alias === "new")).toHaveLength(3);
  expect(
    full.slash.find((row) => row.commandId === "first-window:new")?.scope,
  ).toBe("first-window");

  const first = scopeSnapshot(full, "first-window");
  expect(first.slash.map((row) => `${row.alias}=${row.commandId}`)).toEqual([
    "new=first-window:new",
    "help=shell:help",
  ]);
  expect(first.bindings.map((row) => row.commandId)).toEqual([
    "first-window:new",
  ]);
  expect(first.palette.map((row) => row.commandId).sort()).toEqual([
    "first-window:new",
    "shell:help",
  ]);
  expect(first.agent.map((row) => row.commandId)).toEqual(["first-window:new"]);
  expect(full.agent.map((row) => Object.hasOwn(row, "scope"))).toEqual([
    true,
    true,
  ]);

  const none = scopeSnapshot(full, null);
  expect(none.agent).toEqual([]);
  expect(none.slash.map((row) => row.commandId)).toEqual([
    "shell:help",
    "shell:help",
  ]);
  expect(none.bindings.map((row) => row.commandId)).toEqual(["shell:help"]);
  await expect(
    runtime.execute("second-window:new", { origin: "programmatic" }),
  ).resolves.toEqual({ status: "handled" });
});
