import * as z from "zod";

const json = z.json();
/** Preserve readonly domain collections while deriving contracts from schemas. */
export type ReadonlySchemaValue<T> = T extends (infer Item)[]
  ? readonly ReadonlySchemaValue<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: ReadonlySchemaValue<T[Key]> }
    : T;

/** Host-owned availability carried by every discovered agent row. */
export const WhistleAvailabilitySchema = z.lazy(() =>
  z.discriminatedUnion("status", [
    z
      .object({
        /** The action can currently be invoked. */
        status: z.literal("available"),
      })
      .strict(),
    z
      .object({
        /** The action cannot currently be invoked. */
        status: z.literal("unavailable"),
        /** Host-supplied explanation suitable for presentation to a caller. */
        reason: z.string(),
      })
      .strict(),
  ]),
);

/** The JSON value grammar shared by Whistle transports and App adapters. */
export const WhistleJsonValueSchema = json;
/** JSON values accepted at Whistle transport boundaries. */
export type WhistleJsonValue = ReadonlySchemaValue<
  z.output<typeof WhistleJsonValueSchema>
>;

/** One JSON object, used for action schemas and custom presentation data. */
export const WhistleJsonObjectSchema = z.lazy(() =>
  z.record(z.string(), WhistleJsonValueSchema),
);
/** A JSON object accepted at Whistle transport boundaries. */
export type WhistleJsonObject = ReadonlySchemaValue<
  z.output<typeof WhistleJsonObjectSchema>
>;

/** Parse copied JSON data at an untrusted transport boundary. */
export const parseJsonValue: typeof WhistleJsonValueSchema.parse = (value) =>
  WhistleJsonValueSchema.parse(value);

/** Parse a copied JSON object at an untrusted transport boundary. */
export const parseJsonObject: typeof WhistleJsonObjectSchema.parse = (value) =>
  WhistleJsonObjectSchema.parse(value);

/** General portable failure data for adapters that cross a transport. */
export const WhistleFailureSchema = z.lazy(() =>
  z
    .object({
      code: z.string().min(1).max(160),
      message: z.string().min(1).max(512),
      details: WhistleJsonValueSchema.optional(),
    })
    .strict(),
);
/** Portable failure data that crosses Whistle transports. */
export type WhistleFailure = ReadonlySchemaValue<
  z.output<typeof WhistleFailureSchema>
>;

/** Parse failure data without carrying an Error or stack across the wire. */
export const parseFailure: typeof WhistleFailureSchema.parse = (value) =>
  WhistleFailureSchema.parse(value);

/** The JSON object shape used by Whistle action schemas. */
export const WhistleActionSchemaSchema = WhistleJsonObjectSchema;
/** JSON Schema document used as an action input or output contract. */
export type WhistleActionSchema = ReadonlySchemaValue<
  z.output<typeof WhistleActionSchemaSchema>
>;

const meaningful = z.lazy(() =>
  z.string().refine((value) => value.trim().length > 0),
);

const availabilitySchema = WhistleAvailabilitySchema;
/** Host-owned availability fact carried in agent snapshots. */
export type WhistleAvailability = ReadonlySchemaValue<
  z.output<typeof WhistleAvailabilitySchema>
>;

/** Validate renderer-neutral presentation data attached to an action. */
export const WhistleActionPresentationSchema = z.lazy(() =>
  z.union([
    z.object({ type: z.literal("action") }).strict(),
    z
      .object({
        type: z.literal("custom"),
        data: WhistleJsonObjectSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("choice"),
        options: z.array(
          z.object({
            value: WhistleJsonValueSchema,
            label: meaningful,
            description: meaningful.optional(),
          }),
        ),
      })
      .strict(),
    z
      .object({
        type: z.literal("form"),
        submitLabel: meaningful.optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("confirmation"),
        message: meaningful,
        confirmLabel: meaningful.optional(),
        cancelLabel: meaningful.optional(),
      })
      .strict(),
  ]),
);
/** Renderer-neutral presentation data attached to an action. */
export type WhistleActionPresentation = ReadonlySchemaValue<
  z.output<typeof WhistleActionPresentationSchema>
>;

/** Validate the serializable action contract carried by a command. */
export const WhistleActionDataSchema = z.lazy(() =>
  z
    .object({
      inputSchema: WhistleActionSchemaSchema.optional(),
      outputSchema: WhistleActionSchemaSchema.optional(),
      presentation: WhistleActionPresentationSchema.optional(),
    })
    .strict(),
);
/** Serializable action data accepted by Whistle. */
export type WhistleAction = ReadonlySchemaValue<
  z.output<typeof WhistleActionDataSchema>
>;

const safeOrder = z.lazy(() =>
  z
    .number()
    .int()
    .refine((value) => Number.isSafeInteger(value)),
);

/** Validate aliases and argument mapping metadata for slash commands. */
export const WhistleSlashArgumentsSchema = z.lazy(() =>
  z
    .object({
      hint: meaningful.pipe(z.string().max(120)),
      words: z
        .array(
          z
            .object({
              word: z.string().regex(/^\S{1,64}$/u),
              description: meaningful.pipe(z.string().max(512)).optional(),
              arguments: WhistleJsonObjectSchema,
            })
            .strict(),
        )
        .max(32)
        .optional(),
      text: z
        .object({
          field: meaningful.pipe(z.string().max(120)),
          arguments: WhistleJsonObjectSchema,
          requestIdField: meaningful.pipe(z.string().max(120)).optional(),
        })
        .strict()
        .optional(),
    })
    .strict()
    .refine(
      (grammar) => grammar.words !== undefined || grammar.text !== undefined,
      "slash arguments need words or text",
    ),
);
/** Slash command parsing metadata accepted from transport owners. */
export type WhistleSlashArguments = ReadonlySchemaValue<
  z.output<typeof WhistleSlashArgumentsSchema>
>;
/** A fixed word and its action arguments within a slash command. */
export type WhistleSlashWord = ReadonlySchemaValue<
  NonNullable<z.output<typeof WhistleSlashArgumentsSchema>["words"]>[number]
>;

const orderedProjectionSchema = z.lazy(() =>
  z.object({ order: safeOrder.optional() }).strict(),
);
/** Validate explicit membership and ordering across Whistle surfaces. */
export const WhistleCommandProjectionsSchema = z.lazy(() =>
  z
    .object({
      bindings: z
        .object({
          order: safeOrder.optional(),
          values: z.array(meaningful).max(16),
        })
        .strict()
        .optional(),
      agent: z
        .object({
          keybind: meaningful.optional(),
          order: safeOrder.optional(),
        })
        .strict()
        .optional(),
      help: orderedProjectionSchema.optional(),
      menu: orderedProjectionSchema.optional(),
      palette: orderedProjectionSchema.optional(),
      slash: z
        .object({
          aliases: z.array(meaningful).max(16),
          consumesDraft: z.boolean().optional(),
          order: safeOrder.optional(),
          arguments: WhistleSlashArgumentsSchema.optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
);
/** Projection membership selected by a semantic command owner. */
export type WhistleCommandProjections = ReadonlySchemaValue<
  z.output<typeof WhistleCommandProjectionsSchema>
>;

/** Validate data-only command definitions supplied by an adapter. */
export const WhistleCommandDefinitionSchema = z.lazy(() =>
  z
    .object({
      id: meaningful.refine((value) => !value.includes(":")),
      title: meaningful,
      category: meaningful,
      description: meaningful.optional(),
      projections: WhistleCommandProjectionsSchema.optional(),
      action: WhistleActionDataSchema.optional(),
      availability: availabilitySchema.optional(),
    })
    .strict(),
);
/** Data-only command definition accepted at adapter boundaries. */
export type WhistleCommandDefinition = ReadonlySchemaValue<
  z.output<typeof WhistleCommandDefinitionSchema>
>;

/** Parse action metadata once before an adapter constructs a Whistle command. */
export const parseAction: typeof WhistleActionDataSchema.parse = (value) =>
  WhistleActionDataSchema.parse(value);

/** Parse the Whistle-owned projection metadata supplied by an App. */
export const parseProjections: typeof WhistleCommandProjectionsSchema.parse = (
  value,
) => WhistleCommandProjectionsSchema.parse(value);

/** Parse an availability fact while preserving its reason. */
export const parseAvailability: typeof availabilitySchema.parse = (value) =>
  availabilitySchema.parse(value);

/** Parse one data-only command definition before an adapter creates a command. */
export const parseCommandDefinition: typeof WhistleCommandDefinitionSchema.parse =
  (value) => WhistleCommandDefinitionSchema.parse(value);

/** Semantic action data; client presentation is intentionally not wire data. */
const WhistleAgentActionSchema = z.lazy(() =>
  z
    .object({
      inputSchema: WhistleActionSchemaSchema.optional(),
      outputSchema: WhistleActionSchemaSchema.optional(),
    })
    .strict(),
);

/** One neutral agent row emitted by Whistle's `snapshot.agent` projection. */
export const WhistleAgentProjectionSchema = z.lazy(() =>
  z
    .object({
      commandId: z.string(),
      sourceId: z.string(),
      scope: z.string().optional(),
      title: z.string(),
      category: z.string(),
      description: z.string().optional(),
      order: z.number(),
      availability: WhistleAvailabilitySchema,
      action: WhistleAgentActionSchema.optional(),
      keybind: z.string().optional(),
    })
    .strict(),
);
/** Decoded agent projection data as received across the wire. */
export type WhistleAgentProjectionData = z.output<
  typeof WhistleAgentProjectionSchema
>;

/** A neutral Whistle agent projection collection. */
export const WhistleAgentProjectionsSchema = z.array(
  WhistleAgentProjectionSchema,
);

/** Decode an untrusted agent projection collection at the wire boundary. */
export const parse: typeof WhistleAgentProjectionsSchema.parse = (value) =>
  WhistleAgentProjectionsSchema.parse(value);

/** Longest prompt answer or message an interaction carries. */
export const interactionTextLimit = 8192;

const shortText = meaningful.pipe(z.string().max(interactionTextLimit));
const webUrl = z.url({ protocol: /^https?$/u });

/** Validate renderer-neutral interaction prompts received from a host. */
export const WhistlePromptSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("choice"),
      message: shortText,
      collapsedGroup: shortText.optional(),
      options: z
        .array(
          z
            .object({
              value: shortText,
              label: shortText,
              description: shortText.optional(),
              group: shortText.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(256),
    })
    .strict(),
  z
    .object({
      type: z.literal("text"),
      message: shortText,
      placeholder: shortText.optional(),
      secret: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("confirmation"),
      message: shortText,
      confirmLabel: shortText.optional(),
      cancelLabel: shortText.optional(),
    })
    .strict(),
]);
/** A renderer-neutral interaction prompt. */
export type WhistlePrompt = ReadonlySchemaValue<
  z.output<typeof WhistlePromptSchema>
>;
/** One selectable value in a parsed interaction prompt. */
export type WhistlePromptOption = NonNullable<
  Extract<WhistlePrompt, { type: "choice" }>["options"][number]
>;

/** Validate interaction notices received from a host. */
export const WhistleNoticeSchema = z.lazy(() =>
  z.discriminatedUnion("type", [
    z
      .object({
        type: z.literal("info"),
        message: shortText,
        links: z
          .array(
            z.object({ url: webUrl, label: shortText.optional() }).strict(),
          )
          .max(16)
          .optional(),
      })
      .strict(),
    z.object({ type: z.literal("progress"), message: shortText }).strict(),
    z
      .object({
        type: z.literal("handoff"),
        url: webUrl,
        code: shortText.optional(),
        message: shortText.optional(),
      })
      .strict(),
    z.object({ type: z.literal("success"), message: shortText }).strict(),
  ]),
);
/** A renderer-neutral interaction notice. */
export type WhistleNotice = ReadonlySchemaValue<
  z.output<typeof WhistleNoticeSchema>
>;
/** One link included in a parsed informational notice. */
export type WhistleNoticeLink = ReadonlySchemaValue<
  NonNullable<
    Extract<z.output<typeof WhistleNoticeSchema>, { type: "info" }>["links"]
  >[number]
>;

/** Parse one interaction prompt at the boundary where a client renders it. */
export const parsePrompt: typeof WhistlePromptSchema.parse = (value) =>
  WhistlePromptSchema.parse(value);

/** Parse one interaction notice at the boundary where a client renders it. */
export const parseNotice: typeof WhistleNoticeSchema.parse = (value) =>
  WhistleNoticeSchema.parse(value);

/** Answer types owned by the closed prompt vocabulary. */
export type WhistlePromptAnswers = {
  confirmation: boolean;
  text: string;
  choice: string;
};

/** A prompt and its discriminator remain correlated through generic dispatch. */
export type WhistlePromptOf<Kind extends WhistlePrompt["type"]> = {
  [K in Kind]: Extract<WhistlePrompt, { type: K }> & { readonly type: K };
}[Kind];

type PromptAnswerSchemas = {
  [K in WhistlePrompt["type"]]: (
    prompt: WhistlePromptOf<K>,
  ) => z.ZodType<WhistlePromptAnswers[K]>;
};

const answerSchemas: PromptAnswerSchemas = {
  confirmation: (prompt) => {
    WhistlePromptSchema.options[2].parse(prompt);
    return z.boolean();
  },
  text: (prompt) => {
    WhistlePromptSchema.options[1].parse(prompt);
    return z.string().max(interactionTextLimit);
  },
  choice: (prompt) => {
    const request = WhistlePromptSchema.options[0].parse(prompt);
    const answer = z
      .string()
      .refine((value) =>
        request.options.some((option) => option.value === value),
      );
    return answer;
  },
};

/** Capture a prompt's parsed answer contract before handing it to a renderer. */
export function createPromptAnswerParser<Kind extends WhistlePrompt["type"]>(
  prompt: WhistlePromptOf<Kind>,
): (value: string | boolean) => WhistlePromptAnswers[Kind] {
  const schema = answerSchemas[prompt.type](prompt);
  return (value) => schema.parse(value);
}

/** Parse the answer a human gave to one prompt before the command sees it. */
export function parsePromptAnswer<Kind extends WhistlePrompt["type"]>(
  prompt: WhistlePromptOf<Kind>,
  value: string | boolean,
): WhistlePromptAnswers[Kind] {
  return createPromptAnswerParser(prompt)(value);
}

/** Capture a typed answer decoder; invalid input stays an explicit outcome. */
export function createPromptAnswerDecoder<Kind extends WhistlePrompt["type"]>(
  prompt: WhistlePromptOf<Kind>,
): (
  value: string | boolean,
) =>
  | Readonly<{ kind: "accepted"; value: WhistlePromptAnswers[Kind] }>
  | Readonly<{ kind: "invalid"; cause: z.ZodError }> {
  const schema = answerSchemas[prompt.type](prompt);
  return (value) => {
    const result = schema.safeParse(value);
    return result.success
      ? { kind: "accepted", value: result.data }
      : { kind: "invalid", cause: result.error };
  };
}

/** Decode a human answer without throwing so renderers can handle invalid input. */
export function decodePromptAnswer<Kind extends WhistlePrompt["type"]>(
  prompt: WhistlePromptOf<Kind>,
  value: string | boolean,
) {
  return createPromptAnswerDecoder(prompt)(value);
}
