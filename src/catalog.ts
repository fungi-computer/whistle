import * as z from "zod";

import {
  WhistleActionError,
  type WhistleCommand,
  type WhistleCommandDefinition,
  type WhistleExecutionInput,
  type WhistleJsonObject,
  type WhistleJsonValue,
  type WhistlePrompt,
  type WhistlePromptOption,
} from "./index.js";
import {
  parseJsonObject,
  WhistleCommandDefinitionSchema,
  WhistleJsonObjectSchema,
  WhistleJsonValueSchema,
  WhistleNoticeSchema,
  WhistlePromptSchema,
} from "./wire.js";
import type { ReadonlySchemaValue } from "./wire.js";

/** The one catalog protocol this Whistle understands. */
export const whistleCatalogProtocol = "whistle.catalog/v1";

/**
 * A backend's advertised command catalog: data-only command definitions a
 * client turns into Whistle commands. Every command runs through the backend's
 * own call door; the client never names a command in code.
 */
/** Call one advertised command at its backend; resolves to a raw step. */
export type WhistleCatalogInvoke = (
  commandId: string,
  args: WhistleJsonObject,
  signal: AbortSignal,
) => Promise<WhistleJsonValue>;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type CatalogCommand = Mutable<WhistleCommand>;
type ConfirmationPrompt = Mutable<
  Extract<WhistlePrompt, { type: "confirmation" }>
>;
type SecretPrompt = Extract<WhistlePrompt, { type: "text" }>;

const maximumCatalogCommands = 128;
const maximumSteps = 16;

/** Validate one complete Whistle catalog and its unique command ids. */
export const WhistleCatalogSchema = z
  .object({
    protocol: z.literal(whistleCatalogProtocol),
    commands: z
      .array(WhistleCommandDefinitionSchema)
      .max(maximumCatalogCommands),
  })
  .strict()
  .transform((catalog) => {
    const ids = new Set<string>();
    for (const command of catalog.commands) {
      if (ids.has(command.id))
        throw new Error(`Catalog command ${command.id} is repeated`);
      ids.add(command.id);
    }
    return Object.freeze({
      protocol: whistleCatalogProtocol,
      commands: Object.freeze(catalog.commands),
    });
  });

/** An advertised command catalog decoded by the maintained catalog schema. */
export type WhistleCatalogV1 = ReadonlySchemaValue<
  z.output<typeof WhistleCatalogSchema>
>;

/** Parse an advertised catalog at the client boundary. */
export const parseCatalog: typeof WhistleCatalogSchema.parse = (value) =>
  WhistleCatalogSchema.parse(value);

/** Validate one response step before it reaches an interaction renderer. */
export const WhistleCatalogStepSchema = z
  .discriminatedUnion("type", [
    z
      .object({
        type: z.literal("done"),
        notice: WhistleNoticeSchema.optional(),
        result: WhistleJsonValueSchema.optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("prompt"),
        prompt: WhistlePromptSchema,
        notice: WhistleNoticeSchema.optional(),
        next: z
          .object({
            arguments: WhistleJsonObjectSchema,
            answer: z.string().min(1).max(120),
          })
          .strict(),
      })
      .strict(),
  ])
  .transform((step) => Object.freeze(step));

/** A decoded catalog response step derived from its maintained schema. */
export type WhistleCatalogStepV1 = ReadonlySchemaValue<
  z.output<typeof WhistleCatalogStepSchema>
>;

/** Parse one backend reply before any of it reaches a renderer. */
export const parseCatalogStep: typeof WhistleCatalogStepSchema.parse = (
  value,
) => WhistleCatalogStepSchema.parse(value);

function initialArguments(
  definition: WhistleCommandDefinition,
  input: WhistleExecutionInput,
): Promise<WhistleJsonObject | undefined> | WhistleJsonObject | undefined {
  if (input.arguments !== undefined) {
    try {
      return parseJsonObject(input.arguments);
    } catch {
      throw new WhistleActionError(
        "invalid_arguments",
        `${definition.title}: arguments must be an object`,
      );
    }
  }
  const presentation = definition.action?.presentation;
  const interaction = input.interaction;
  if (interaction === undefined || presentation === undefined) return {};
  if (presentation.type === "choice") {
    const options = presentation.options;
    return interaction
      .prompt({
        type: "choice",
        message: definition.title,
        options: options.map((option, index) => {
          const choice: WhistlePromptOption = {
            value: String(index),
            label: option.label,
          };
          return option.description === undefined
            ? choice
            : { ...choice, description: option.description };
        }),
      })
      .then((answer) => parseJsonObject(options[Number(answer)]?.value));
  }
  if (presentation.type === "confirmation") {
    const confirmation: ConfirmationPrompt = {
      type: "confirmation",
      message: presentation.message,
    };
    if (presentation.confirmLabel !== undefined)
      confirmation.confirmLabel = presentation.confirmLabel;
    if (presentation.cancelLabel !== undefined)
      confirmation.cancelLabel = presentation.cancelLabel;
    return interaction
      .prompt(confirmation)
      .then((confirmed) => (confirmed ? {} : undefined));
  }
  return {};
}

/**
 * Turn an advertised catalog into Whistle commands. Each handler runs the
 * backend's step conversation through the caller's interaction; an Agent,
 * which has no interaction, can run only commands that finish in one step.
 */
export function catalogCommands(
  catalog: WhistleCatalogV1,
  invoke: WhistleCatalogInvoke,
): readonly WhistleCommand<never>[] {
  return catalog.commands.map((definition) => {
    const { availability, ...rest } = definition;
    const command: CatalogCommand = {
      id: rest.id,
      title: rest.title,
      category: rest.category,
      handler: async (input: WhistleExecutionInput) => {
        const signal = input.signal ?? new AbortController().signal;
        const interaction = input.interaction;
        let args = await initialArguments(definition, input);
        if (args === undefined) return { cancelled: true };
        let secrets = new Map<string, SecretPrompt>();
        for (let step = 0; step < maximumSteps; step += 1) {
          signal.throwIfAborted();
          const stepArguments: WhistleJsonObject = args;
          const stepSecrets = secrets;
          const call = async () => {
            // The retry continuation holds only non-secret arguments and the
            // questions. Credentials exist only in this invocation's payload.
            const attemptArguments = {
              ...stepArguments,
            };
            try {
              if (interaction !== undefined)
                for (const [field, prompt] of stepSecrets)
                  Object.defineProperty(attemptArguments, field, {
                    value: await interaction.prompt(prompt),
                    enumerable: true,
                    configurable: true,
                  });
              const reply = parseCatalogStep(
                await invoke(definition.id, attemptArguments, signal),
              );
              const nextSecrets = new Map<string, SecretPrompt>();
              if (reply.type === "done") return { reply, secrets: nextSecrets };
              const nextArguments = { ...reply.next.arguments };
              for (const [field, prompt] of stepSecrets) {
                if (
                  field !== reply.next.answer &&
                  Object.hasOwn(nextArguments, field)
                )
                  nextSecrets.set(field, prompt);
                Reflect.deleteProperty(nextArguments, field);
              }
              if (
                reply.prompt.type === "text" &&
                reply.prompt.secret === true
              ) {
                nextSecrets.set(reply.next.answer, reply.prompt);
                Reflect.deleteProperty(nextArguments, reply.next.answer);
              }
              return {
                reply: {
                  ...reply,
                  next: { ...reply.next, arguments: nextArguments },
                },
                secrets: nextSecrets,
              };
            } finally {
              for (const field of stepSecrets.keys())
                Reflect.deleteProperty(attemptArguments, field);
            }
          };
          const { reply, secrets: nextSecrets } =
            interaction === undefined
              ? await call()
              : await interaction.run(call);
          if (reply.notice !== undefined) interaction?.notify(reply.notice);
          if (reply.type === "done") return reply.result;
          if (interaction === undefined)
            throw new WhistleActionError(
              "interaction_required",
              `${definition.title} needs a person to answer: ${reply.prompt.message}`,
            );
          secrets = nextSecrets;
          if (reply.prompt.type === "text" && reply.prompt.secret === true) {
            args = reply.next.arguments;
            continue;
          }
          const answer = await interaction.prompt(reply.prompt);
          args = { ...reply.next.arguments, [reply.next.answer]: answer };
        }
        throw new WhistleActionError(
          "flow_too_long",
          `${definition.title} asked too many questions.`,
        );
      },
    };
    if (rest.description !== undefined) command.description = rest.description;
    if (rest.projections !== undefined) command.projections = rest.projections;
    if (rest.action !== undefined) command.action = rest.action;
    if (availability !== undefined) command.availability = () => availability;
    return command;
  });
}
