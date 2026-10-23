import type {
  WhistleAction,
  WhistleActionPresentation,
  WhistleActionSchema,
  WhistleAvailability,
  WhistleCommandProjections,
  WhistleFailure,
  WhistleJsonValue,
  WhistleNotice,
  WhistlePrompt,
  WhistlePromptOf,
  WhistlePromptAnswers,
  WhistleSlashArguments,
} from "./wire.js";

export type {
  WhistleAction,
  WhistleActionPresentation,
  WhistleActionSchema,
  WhistleAvailability,
  WhistleCommandProjections,
  WhistleCommandDefinition,
  WhistleFailure,
  WhistleJsonObject,
  WhistleJsonValue,
  WhistleNotice,
  WhistleNoticeLink,
  WhistlePrompt,
  WhistlePromptOption,
  WhistleSlashArguments,
  WhistleSlashWord,
} from "./wire.js";

/** The trusted host origin entering the single execution door. */
export type WhistleExecutionOrigin =
  | "agent"
  | "browser"
  | "keyboard"
  | "menu"
  | "palette"
  | "programmatic"
  | "slash"
  | "terminal";

/** A source-owned command's execution callback, invoked only through the execution door. */
export type WhistleCommandHandler<Arguments, Result> = {
  /** Runs the command for one execution input and returns its result. */
  bivarianceHack(
    input: WhistleExecutionInput<Arguments>,
  ): Result | undefined | Promise<Result | undefined>;
}["bivarianceHack"];

/** The answer type for one prompt kind. */
export type WhistlePromptAnswer<Prompt extends WhistlePrompt> =
  WhistlePromptAnswers[Prompt["type"]];

/**
 * A human conversation attached to one execution. `prompt` rejects when the
 * human cancels; `signal` aborts when the whole interaction is dismissed.
 */
export type WhistleInteraction = Readonly<{
  /** Aborted when the human dismisses the interaction. */
  signal: AbortSignal;
  /**
   * Ask one question and wait for its answer. `signal` withdraws just this
   * question, e.g. when an out-of-band callback answers it first.
   */
  prompt: <Kind extends WhistlePrompt["type"]>(
    prompt: WhistlePromptOf<Kind>,
    options?: Readonly<{ signal?: AbortSignal }>,
  ) => Promise<WhistlePromptAnswers[Kind]>;
  /** Show one status update. */
  notify: (notice: WhistleNotice) => void;
  /**
   * Run one retryable operation. Once the conversation has asked a question or
   * shown progress/a handoff, failure waits for the human to retry that operation
   * with its captured inputs or dismiss it. Earlier successful steps are not
   * replayed. Before a conversation opens, failures propagate normally.
   * Operations within an interaction are serial.
   */
  run: <Result>(operation: () => Promise<Result>) => Promise<Result>;
}>;

/** How an execution with an attached interaction ended. */
export type WhistleInteractionEnd =
  | Readonly<{
      /** The handler finished. */
      status: "handled";
    }>
  | Readonly<{
      /** The human dismissed the interaction. */
      status: "cancelled";
    }>
  | Readonly<{
      /** The handler failed. */
      status: "failed";
      /** Portable failure message for the human. */
      message: string;
    }>;

/** One interaction a presenter opened for one execution. */
export type WhistleInteractionSession = Readonly<{
  /** The interaction handed to the command handler. */
  interaction: WhistleInteraction;
  /** Called exactly once when the handler settles. */
  settle: (end: WhistleInteractionEnd) => void;
}>;

/**
 * A mounted client that can render interactions. Whistle opens one session per
 * human execution that has no caller-supplied interaction.
 */
export type WhistlePresenter = (
  request: Readonly<{
    /** Canonical namespace-local command identity. */
    commandId: string;
    /** Human-facing command title. */
    title: string;
  }>,
) => WhistleInteractionSession;

/** The already-typed input supplied to a command handler. */
export type WhistleExecutionInput<Arguments = unknown> = Readonly<{
  /** The host origin requesting execution. */
  origin: WhistleExecutionOrigin;
  /** Typed action arguments, when this execution carries user input. */
  arguments?: Arguments;
  /** Host-owned cancellation for this invocation; never part of projections. */
  signal?: AbortSignal;
  /**
   * Human conversation for this invocation. Supplied by the caller, or by the
   * runtime's registered presenter for human origins; absent for agents.
   */
  interaction?: WhistleInteraction;
}>;

/** An owning handler's explicit failure code and optional structured details. */
export class WhistleActionError extends Error {
  public constructor(
    /** Stable failure identity supplied by the handler owner. */
    public readonly code: string,
    message: string,
    /** Optional JSON context safe to return to the caller. */
    public readonly details?: WhistleJsonValue,
  ) {
    super(message);
    this.name = "WhistleActionError";
  }
}

/** The normalized result of one command execution request. */
export type WhistleExecutionOutcome<Result = unknown> =
  | Extract<
      WhistleAvailability,
      {
        /** Current host facts prevented dispatch to the handler. */
        status: "unavailable";
      }
    >
  | Readonly<{
      /** The admitted handler completed synchronously or asynchronously. */
      status: "handled";
      /** The typed handler result, when it produced one. */
      result?: Result;
    }>
  | Readonly<{
      /** The runtime was closed before this execution began. */
      status: "closed";
    }>
  | Readonly<{
      /** No currently admitted command has the requested identity. */
      status: "missing";
    }>
  | Readonly<{
      /** The requested command identity is blank. */
      status: "invalid";
    }>
  | Readonly<{
      /** The normalized error raised by the admitted handler. */
      error: WhistleFailure;
      /** The admitted handler failed. */
      status: "failed";
    }>;

/** A valid contribution was attempted after the runtime closed. */
export class WhistleClosedError extends Error {
  /** Construct the provisional error for a valid post-close contribution. */
  constructor() {
    super("Whistle runtime is closed");
    this.name = "WhistleClosedError";
  }
}

/** One semantic command definition. */
export type WhistleCommand<Arguments = unknown, Result = unknown> = Readonly<{
  /** The source-local command identity segment. */
  id: string;
  /** Human-facing command title. */
  title: string;
  /** Human-facing command category. */
  category: string;
  /** Optional human-facing command description. */
  description?: string | undefined;
  /** Explicit projection membership and per-surface metadata. */
  projections?: WhistleCommandProjections;
  /** Typed action contract and renderer-neutral presentation hint. */
  action?: WhistleAction;
  /** Read current host facts on discovery and immediately before dispatch. */
  availability?: () => WhistleAvailability;
  /** Host-owned callback invoked only through the execution door. */
  handler: WhistleCommandHandler<Arguments, Result>;
}>;

/** One contribution of source-owned commands to a namespace. */
export type WhistleContribution = Readonly<{
  /** Source authority identity for this contribution. */
  sourceId: string;
  /** Namespace receiving this contribution. */
  namespace: string;
  /**
   * Focus scope, e.g. one mounted App window. Omitted means global. Slash
   * aliases are unique within one scope; {@link scopeSnapshot} lets a focused
   * scope's alias or binding shadow the same global one.
   */
  scope?: string;
  /** Ordered command definitions in this contribution. */
  commands: readonly WhistleCommand<never>[];
}>;

/** Shared immutable metadata carried by each projection row. */
export type WhistleProjectionRow = Readonly<{
  /** Canonical namespace-local command identity. */
  commandId: string;
  /** Source authority identity. */
  sourceId: string;
  /** Focus scope of the contribution; omitted for global rows. */
  scope?: string;
  /** Human-facing command title. */
  title: string;
  /** Human-facing command category. */
  category: string;
  /** Optional human-facing command description. */
  description?: string | undefined;
  /** Explicit order within the containing surface. */
  order: number;
  /** Typed action contract and renderer-neutral presentation hint. */
  action?: WhistleAction;
  /** An unavailable command stays discoverable with its explanation. */
  availability: WhistleAvailability;
}>;

/** Immutable agent snapshot row composed from the schema-owned action data. */
export type WhistleAgentProjection = Omit<WhistleProjectionRow, "action"> &
  Readonly<{
    /** Semantic inputs and outputs; client presentation stays local. */
    action?: Pick<WhistleAction, "inputSchema" | "outputSchema">;
    /** Optional host-owned key label. */
    keybind?: string;
  }>;

/** One binding value projected from a command. */
export type WhistleBindingProjection = WhistleProjectionRow &
  Readonly<{
    /** One binding value exposed for the command. */
    binding: string;
  }>;

/** One palette value projected from a command. */
export type WhistlePaletteProjection = WhistleProjectionRow;

/** One slash alias projected from a command. */
export type WhistleSlashProjection = WhistleProjectionRow &
  Readonly<{
    /** One slash alias exposed for the command. */
    alias: string;
    /** Consume the submitted draft before opening the command's interaction. */
    consumesDraft?: boolean;
    /** How text after the alias becomes arguments, when the command takes any. */
    arguments?: WhistleSlashArguments;
  }>;

/** One help value projected from a command. */
export type WhistleHelpProjection = WhistleProjectionRow;

/** One menu value projected from a command. */
export type WhistleMenuProjection = WhistleProjectionRow;

/** The six immutable views of one semantic command graph. */
export type WhistleSnapshot = Readonly<{
  /** Binding rows derived from the semantic graph. */
  bindings: readonly WhistleBindingProjection[];
  /** Palette rows derived from the semantic graph. */
  palette: readonly WhistlePaletteProjection[];
  /** Slash rows derived from the semantic graph. */
  slash: readonly WhistleSlashProjection[];
  /** Help rows derived from the semantic graph. */
  help: readonly WhistleHelpProjection[];
  /** Menu rows derived from the semantic graph. */
  menu: readonly WhistleMenuProjection[];
  /** Agent rows derived from the semantic graph. */
  agent: readonly WhistleAgentProjection[];
}>;

/** An idempotent lease for one contribution generation. */
export type WhistleContributionLease = Readonly<{
  /** Atomically replace this generation's commands without changing ownership. */
  update: (commands: WhistleContribution["commands"]) => void;
  /** Dispose this contribution generation. */
  dispose: () => void;
}>;

/** The provisional Whistle semantic runtime seam. */
export type WhistleRuntime = Readonly<{
  /** Admit one source-owned contribution. */
  contribute: (contribution: WhistleContribution) => WhistleContributionLease;
  /**
   * Synchronously release the live graph into the shared empty closed snapshot.
   * Repeated calls are no-ops.
   *
   * @returns `undefined`; close produces no value.
   */
  close: () => undefined;
  /** Execute one currently admitted command through the shared door. */
  execute: (
    commandId: string,
    input: WhistleExecutionInput,
  ) => Promise<WhistleExecutionOutcome>;
  /** Pull the current immutable semantic snapshot. */
  snapshot: () => WhistleSnapshot;
  /** Observe coherent semantic graph changes. */
  subscribe: (listener: () => void) => () => void;
  /**
   * Register the mounted client that renders interactions for human
   * executions. The newest registration wins until its disposer runs.
   */
  present: (presenter: WhistlePresenter) => () => void;
}>;

export {
  createWhistleKeymapAdapter,
  type WhistleKeymapAdapter,
  type WhistleKeymapBinding,
  type WhistleKeymapCommand,
  type WhistleKeymapHost,
  type WhistleKeymapLayer,
} from "./keymap.js";

/**
 * The projection for one focused scope: global rows plus the focused
 * scope's rows. A focused slash alias or binding shadows the same global one.
 * Agent rows follow the same scope filter; the complete runtime remains whole.
 *
 * @param snapshot - A complete runtime snapshot.
 * @param scope - The focused scope, or `null` when nothing scoped is focused.
 * @returns A frozen snapshot of globals plus the selected scope.
 */
export function scopeSnapshot(
  snapshot: WhistleSnapshot,
  scope: string | null,
): WhistleSnapshot {
  const active = <T extends WhistleProjectionRow>(rows: readonly T[]) =>
    rows.filter((row) => row.scope === undefined || row.scope === scope);
  const shadowed = <T extends WhistleProjectionRow>(
    rows: readonly T[],
    key: (row: T) => string,
  ) => {
    const focused = new Set(rows.filter((row) => row.scope === scope).map(key));
    return Object.freeze(
      active(rows).filter(
        (row) => row.scope !== undefined || !focused.has(key(row)),
      ),
    );
  };
  return Object.freeze({
    bindings: shadowed(snapshot.bindings, (row) => row.binding),
    palette: Object.freeze(active(snapshot.palette)),
    slash: shadowed(snapshot.slash, (row) => row.alias),
    help: Object.freeze(active(snapshot.help)),
    menu: Object.freeze(active(snapshot.menu)),
    agent: Object.freeze(active(snapshot.agent)),
  });
}

/** Construct the provisional semantic runtime shell. */
export function createWhistle(): WhistleRuntime {
  let closed = false;
  let currentSnapshot: WhistleSnapshot = emptySnapshot;
  let liveContributions: LiveContribution[] = [];
  let previousAvailability: readonly WhistleAvailability[] = [];
  let graphChanged = false;
  let presenters: readonly Readonly<{ presenter: WhistlePresenter }>[] = [];
  const listeners = new Set<() => void>();
  const publish = (): void => {
    for (const listener of listeners) listener();
  };
  const snapshot = (): WhistleSnapshot => {
    if (closed) return emptySnapshot;
    const availability = liveContributions.flatMap((live) =>
      live.contribution.commands.map(readAvailability),
    );
    if (
      graphChanged ||
      availability.some(
        (value, index) => !sameAvailability(value, previousAvailability[index]),
      )
    ) {
      currentSnapshot = snapshotFor(liveContributions, availability);
      previousAvailability = availability;
      graphChanged = false;
    }
    return currentSnapshot;
  };
  return Object.freeze({
    close: (): undefined => {
      if (closed) return undefined;
      closed = true;
      liveContributions = [];
      presenters = [];
      previousAvailability = [];
      currentSnapshot = emptySnapshot;
      publish();
      listeners.clear();
      return undefined;
    },
    contribute: (
      contribution: WhistleContribution,
    ): WhistleContributionLease => {
      validateContribution(contribution);
      if (closed) throw new WhistleClosedError();
      validateConflicts(contribution, liveContributions);
      validateCapacity(contribution, liveContributions);
      const generation = Symbol("whistle-contribution");
      if (!isEmptyContribution(contribution)) {
        liveContributions = [
          ...liveContributions,
          { contribution: copyContribution(contribution), generation },
        ];
        graphChanged = true;
        publish();
      }
      let active = true;
      return makeLease(
        (commands) => {
          if (!active || closed) return;
          const replacement: WhistleContribution = {
            ...contribution,
            commands,
          };
          validateContribution(replacement);
          const ownIndex = liveContributions.findIndex(
            (candidate) => candidate.generation === generation,
          );
          const others = liveContributions.filter(
            (candidate) => candidate.generation !== generation,
          );
          validateConflicts(replacement, others);
          validateCapacity(replacement, others);
          const copied = copyContribution(replacement);
          if (isEmptyContribution(replacement)) {
            if (ownIndex < 0) return;
            liveContributions = others;
          } else if (ownIndex < 0) {
            liveContributions = [
              ...liveContributions,
              { contribution: copied, generation },
            ];
          } else {
            liveContributions = liveContributions.map((candidate) =>
              candidate.generation === generation
                ? { contribution: copied, generation }
                : candidate,
            );
          }
          graphChanged = true;
          publish();
        },
        () => {
          if (!active) return;
          active = false;
          const live = liveContributions.find(
            (candidate) => candidate.generation === generation,
          );
          if (live === undefined) return;
          liveContributions = liveContributions.filter(
            (candidate) => candidate.generation !== generation,
          );
          graphChanged = true;
          publish();
        },
      );
    },
    execute: async (
      commandId: string,
      input: WhistleExecutionInput,
    ): Promise<WhistleExecutionOutcome> => {
      if (commandId.trim().length === 0) return { status: "invalid" };
      if (closed) return { status: "closed" };
      const command = findCommand(commandId, liveContributions);
      if (command === undefined) return { status: "missing" };
      let session: WhistleInteractionSession | undefined;
      try {
        const availability = readAvailability(command);
        if (availability.status === "unavailable") return availability;
        const presenter = presenters.at(-1)?.presenter;
        if (
          input.interaction === undefined &&
          presenter !== undefined &&
          humanOrigins.has(input.origin)
        )
          session = presenter({
            commandId,
            title: command.title,
          });
        const executionInput: WhistleExecutionInput & {
          signal: AbortSignal;
          interaction?: WhistleInteraction;
        } = {
          ...input,
          signal: input.signal ?? new AbortController().signal,
        };
        if (session !== undefined) {
          executionInput.interaction = session.interaction;
          executionInput.signal = AbortSignal.any([
            executionInput.signal,
            session.interaction.signal,
          ]);
        }
        const result = await command.handler(executionInput);
        session?.settle({ status: "handled" });
        return result === undefined
          ? { status: "handled" }
          : { status: "handled", result };
      } catch (error) {
        const failure = failureFor(
          error instanceof Error
            ? error
            : new Error("Command handler threw a non-Error value"),
        );
        session?.settle(
          session.interaction.signal.aborted
            ? { status: "cancelled" }
            : { status: "failed", message: failure.message },
        );
        return { status: "failed", error: failure };
      }
    },
    present: (presenter: WhistlePresenter) => {
      const entry = { presenter };
      if (!closed) presenters = [...presenters, entry];
      return () => {
        presenters = presenters.filter((candidate) => candidate !== entry);
      };
    },
    snapshot,
    subscribe: (listener: () => void) => {
      if (closed) return () => undefined;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
}

/** Origins where a person is present to answer an interaction. */
const humanOrigins: ReadonlySet<WhistleExecutionOrigin> = new Set([
  "browser",
  "keyboard",
  "menu",
  "palette",
  "slash",
  "terminal",
]);

type CopiedContribution = Omit<WhistleContribution, "commands"> & {
  commands: readonly CopiedCommand[];
};

type LiveContribution = Readonly<{
  contribution: CopiedContribution;
  generation: symbol;
}>;

type CopiedCommand = {
  id: string;
  title: string;
  category: string;
  description?: string | undefined;
  projections?: CopiedProjections;
  action?: WhistleAction;
  availability?: () => WhistleAvailability;
  handler: WhistleCommandHandler<unknown, unknown>;
};

type CopiedAction = {
  inputSchema?: WhistleActionSchema;
  outputSchema?: WhistleActionSchema;
  presentation?: WhistleActionPresentation;
};

type CopiedProjections = {
  bindings?: CopiedBindings;
  agent?: CopiedAgent;
  help?: CopiedOrdered;
  menu?: CopiedOrdered;
  palette?: CopiedOrdered;
  slash?: CopiedSlash;
};

type CopiedBindings = { values: string[]; order?: number };
type CopiedAgent = { keybind?: string; order?: number };
type CopiedOrdered = { order?: number };
type CopiedSlash = {
  aliases: string[];
  consumesDraft?: boolean;
  order?: number;
  arguments?: WhistleSlashArguments;
};

const maximumBindingsOrAliases = 16;
const maximumSlashWords = 32;
const maximumLiveContributions = 64;
const maximumLiveCommands = 256;

function findCommand(
  commandId: string,
  liveContributions: readonly LiveContribution[],
): CopiedCommand | undefined {
  for (const live of liveContributions) {
    for (const command of live.contribution.commands) {
      if (`${live.contribution.namespace}:${command.id}` === commandId)
        return command;
    }
  }
  return undefined;
}

function isEmptyContribution(contribution: WhistleContribution): boolean {
  return contribution.commands.length === 0;
}

function validateContribution(contribution: WhistleContribution): void {
  validateMeaningful(contribution.sourceId, "source ID");
  validateMeaningful(contribution.namespace, "namespace", true);
  if (contribution.scope !== undefined)
    validateMeaningful(contribution.scope, "scope");
  for (const command of contribution.commands) validateCommand(command);
}

function validateConflicts(
  contribution: WhistleContribution,
  liveContributions: readonly LiveContribution[],
): void {
  const namespaceOwner = liveContributions.find(
    (live) =>
      live.contribution.namespace === contribution.namespace &&
      live.contribution.sourceId !== contribution.sourceId,
  );
  if (namespaceOwner !== undefined)
    reject("Namespace is already owned by another source");

  const commandIds = new Set<string>();
  const slashAliases = new Set<string>();
  for (const live of liveContributions) {
    const sameScope = live.contribution.scope === contribution.scope;
    for (const command of live.contribution.commands) {
      commandIds.add(`${live.contribution.namespace}:${command.id}`);
      if (sameScope)
        for (const alias of command.projections?.slash?.aliases ?? [])
          slashAliases.add(alias);
    }
  }
  for (const command of contribution.commands) {
    const commandId = `${contribution.namespace}:${command.id}`;
    if (commandIds.has(commandId))
      reject("Canonical command ID is already registered");
    commandIds.add(commandId);
    for (const alias of command.projections?.slash?.aliases ?? []) {
      if (slashAliases.has(alias)) reject("Slash alias is already registered");
      slashAliases.add(alias);
    }
  }
}

function validateCapacity(
  contribution: WhistleContribution,
  liveContributions: readonly LiveContribution[],
): void {
  if (liveContributions.length >= maximumLiveContributions)
    reject("Live contribution capacity exceeded");
  const liveCommandCount = liveContributions.reduce(
    (count, live) => count + live.contribution.commands.length,
    0,
  );
  if (liveCommandCount + contribution.commands.length > maximumLiveCommands)
    reject("Live command capacity exceeded");
}

function copyContribution(
  contribution: WhistleContribution,
): CopiedContribution {
  const copy = {
    sourceId: contribution.sourceId,
    namespace: contribution.namespace,
    commands: contribution.commands.map(copyCommand),
  };
  return contribution.scope === undefined
    ? copy
    : { ...copy, scope: contribution.scope };
}

function copyCommand(command: WhistleCommand<never>): CopiedCommand {
  const copy: CopiedCommand = {
    id: command.id,
    title: command.title,
    category: command.category,
    handler: command.handler,
  };
  if (command.description !== undefined) copy.description = command.description;
  if (command.action !== undefined) copy.action = copyAction(command.action);
  if (command.availability !== undefined)
    copy.availability = command.availability;
  if (command.projections !== undefined)
    copy.projections = copyProjections(command.projections);
  return copy;
}

function copyAction(action: WhistleAction): WhistleAction {
  const copy: CopiedAction = {};
  if (action.inputSchema !== undefined)
    copy.inputSchema = copyJsonObject(action.inputSchema);
  if (action.outputSchema !== undefined)
    copy.outputSchema = copyJsonObject(action.outputSchema);
  if (action.presentation !== undefined)
    copy.presentation = copyPresentation(action.presentation);
  return Object.freeze(copy);
}

function copyJsonObject(value: WhistleActionSchema): WhistleActionSchema {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        copyJsonValue(nested),
      ]),
    ),
  );
}

function copyJsonValue(value: WhistleJsonValue): WhistleJsonValue {
  if (Array.isArray(value)) return Object.freeze(value.map(copyJsonValue));
  if (value !== null && value instanceof Object) {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [
          key,
          copyJsonValue(nested),
        ]),
      ),
    );
  }
  return value;
}

function copyPresentation(
  presentation: WhistleActionPresentation,
): WhistleActionPresentation {
  switch (presentation.type) {
    case "action":
      return Object.freeze({ type: "action" });
    case "custom":
      return Object.freeze({
        type: "custom",
        data: copyJsonObject(presentation.data),
      });
    case "choice":
      return Object.freeze({
        type: "choice",
        options: Object.freeze(
          presentation.options.map((option) =>
            Object.freeze({
              ...option,
              value: copyJsonValue(option.value),
            }),
          ),
        ),
      });
    case "form":
      return Object.freeze({ ...presentation });
    case "confirmation":
      return Object.freeze({ ...presentation });
  }
}

function copyProjections(
  projections: WhistleCommandProjections,
): CopiedProjections {
  const copy: CopiedProjections = {};
  if (projections.bindings !== undefined)
    copy.bindings = copyBindings(projections.bindings);
  if (projections.agent !== undefined)
    copy.agent = copyAgent(projections.agent);
  if (projections.help !== undefined)
    copy.help = copyOrdered(projections.help.order);
  if (projections.menu !== undefined)
    copy.menu = copyOrdered(projections.menu.order);
  if (projections.palette !== undefined)
    copy.palette = copyOrdered(projections.palette.order);
  if (projections.slash !== undefined)
    copy.slash = copySlash(projections.slash);
  return copy;
}

function copyBindings(
  projection: NonNullable<WhistleCommandProjections["bindings"]>,
): CopiedBindings {
  const copy: CopiedBindings = {
    values: [...projection.values],
  };
  if (projection.order !== undefined) copy.order = projection.order;
  return copy;
}

function copyAgent(
  projection: NonNullable<WhistleCommandProjections["agent"]>,
): CopiedAgent {
  const copy: CopiedAgent = {};
  if (projection.keybind !== undefined) copy.keybind = projection.keybind;
  if (projection.order !== undefined) copy.order = projection.order;
  return copy;
}

function copyOrdered(order: number | undefined): CopiedOrdered {
  const copy: CopiedOrdered = {};
  if (order !== undefined) copy.order = order;
  return copy;
}

function copySlash(
  projection: NonNullable<WhistleCommandProjections["slash"]>,
): CopiedSlash {
  const copy: CopiedSlash = {
    aliases: [...projection.aliases],
  };
  if (projection.order !== undefined) copy.order = projection.order;
  if (projection.consumesDraft !== undefined)
    copy.consumesDraft = projection.consumesDraft;
  if (projection.arguments !== undefined)
    copy.arguments = copySlashArguments(projection.arguments);
  return copy;
}

type CopiedSlashArguments = {
  -readonly [K in keyof WhistleSlashArguments]: WhistleSlashArguments[K];
};

function copySlashArguments(
  grammar: WhistleSlashArguments,
): WhistleSlashArguments {
  const copy: CopiedSlashArguments = { hint: grammar.hint };
  if (grammar.words !== undefined)
    copy.words = Object.freeze(
      grammar.words.map((word) =>
        Object.freeze({ ...word, arguments: copyJsonObject(word.arguments) }),
      ),
    );
  if (grammar.text !== undefined)
    copy.text = Object.freeze({
      ...grammar.text,
      arguments: copyJsonObject(grammar.text.arguments),
    });
  return Object.freeze(copy);
}

function validateCommand(command: WhistleCommand<never>): void {
  validateMeaningful(command.id, "command ID", true);
  validateMeaningful(command.title, "title");
  validateMeaningful(command.category, "category");
  validateAction(command.action);
  validateProjections(command.projections);
}

function validateAction(action: WhistleAction | undefined): void {
  if (action?.presentation === undefined) return;
  switch (action.presentation.type) {
    case "action":
    case "custom":
      return;
    case "choice":
      for (const option of action.presentation.options) {
        validateMeaningful(option.label, "choice label");
        if (option.description !== undefined)
          validateMeaningful(option.description, "choice description");
      }
      return;
    case "form":
      if (action.presentation.submitLabel !== undefined)
        validateMeaningful(action.presentation.submitLabel, "submit label");
      return;
    case "confirmation":
      validateMeaningful(action.presentation.message, "confirmation message");
      if (action.presentation.confirmLabel !== undefined)
        validateMeaningful(
          action.presentation.confirmLabel,
          "confirmation label",
        );
      if (action.presentation.cancelLabel !== undefined)
        validateMeaningful(
          action.presentation.cancelLabel,
          "cancellation label",
        );
  }
}

function validateProjections(
  projections: WhistleCommandProjections | undefined,
): void {
  if (projections === undefined) return;

  for (const projection of [
    projections.bindings,
    projections.palette,
    projections.slash,
    projections.help,
    projections.menu,
    projections.agent,
  ]) {
    if (projection !== undefined) validateOrder(projection.order);
  }
  if (projections.bindings !== undefined)
    validateValues(projections.bindings.values, "binding");
  if (projections.slash !== undefined) {
    validateValues(projections.slash.aliases, "slash alias");
    for (const alias of projections.slash.aliases)
      if (/\s/u.test(alias)) reject("slash alias must not contain whitespace");
    validateSlashArguments(projections.slash.arguments);
  }
  if (projections.agent?.keybind !== undefined)
    validateMeaningful(projections.agent.keybind, "agent keybind");
}

function validateSlashArguments(
  grammar: WhistleSlashArguments | undefined,
): void {
  if (grammar === undefined) return;
  validateMeaningful(grammar.hint, "argument hint");
  if (grammar.words === undefined && grammar.text === undefined)
    reject("slash arguments need words or text");
  const words = new Set<string>();
  for (const word of grammar.words ?? []) {
    validateMeaningful(word.word, "argument word");
    if (/\s/u.test(word.word))
      reject("argument word must not contain whitespace");
    if (words.has(word.word)) reject("argument word is repeated");
    words.add(word.word);
    if (word.description !== undefined)
      validateMeaningful(word.description, "argument word description");
  }
  if (words.size > maximumSlashWords) reject("argument word count exceeds 32");
  if (grammar.text !== undefined) {
    validateMeaningful(grammar.text.field, "argument text field");
    if (grammar.text.requestIdField !== undefined)
      validateMeaningful(grammar.text.requestIdField, "request id field");
  }
}

function validateValues(values: readonly string[], label: string): void {
  if (values.length > maximumBindingsOrAliases)
    reject(`${label} count exceeds 16`);
  for (const value of values) validateMeaningful(value, label);
}

function validateMeaningful(
  value: string,
  label: string,
  colonFree = false,
): void {
  if (value.trim().length === 0) reject(`${label} must not be blank`);
  if (colonFree && value.includes(":"))
    reject(`${label} must not contain a colon`);
}

function validateOrder(value: number | undefined): void {
  if (value !== undefined && !Number.isSafeInteger(value))
    reject("order must be a safe integer");
}

function makeLease(
  update: (commands: WhistleContribution["commands"]) => void = () => undefined,
  dispose: () => void = () => undefined,
): WhistleContributionLease {
  return Object.freeze({ update, dispose });
}

function reject(message: string): never {
  throw new Error(message);
}

const emptySnapshot: WhistleSnapshot = Object.freeze({
  bindings: Object.freeze([]),
  palette: Object.freeze([]),
  slash: Object.freeze([]),
  help: Object.freeze([]),
  menu: Object.freeze([]),
  agent: Object.freeze([]),
});

const available: WhistleAvailability = Object.freeze({ status: "available" });

function readAvailability(
  command: Pick<WhistleCommand<never>, "availability">,
): WhistleAvailability {
  const value = command.availability?.() ?? available;
  return value.status === "available"
    ? available
    : Object.freeze({ status: "unavailable", reason: value.reason });
}

function sameAvailability(
  left: WhistleAvailability,
  right: WhistleAvailability | undefined,
): boolean {
  if (left.status === "available") return right?.status === "available";
  return right?.status === "unavailable" && left.reason === right.reason;
}

function failureFor(error: Error): WhistleFailure {
  if (error instanceof WhistleActionError) {
    const failure = {
      code: error.code,
      message: error.message,
    };
    return Object.freeze(
      error.details === undefined
        ? failure
        : { ...failure, details: copyJsonValue(error.details) },
    );
  }
  return Object.freeze({
    code: "command_failed",
    message: error.message,
  });
}

function snapshotFor(
  contributions: readonly LiveContribution[],
  availability: readonly WhistleAvailability[],
): WhistleSnapshot {
  const bindings: WhistleBindingProjection[] = [];
  const palette: WhistlePaletteProjection[] = [];
  const slash: WhistleSlashProjection[] = [];
  const help: WhistleHelpProjection[] = [];
  const menu: WhistleMenuProjection[] = [];
  const agent: WhistleAgentProjection[] = [];
  let commandIndex = 0;

  for (const live of contributions) {
    const contribution = live.contribution;
    for (const command of contribution.commands) {
      const projections = command.projections;
      const commandAvailability = availability[commandIndex++] ?? available;
      if (projections?.bindings !== undefined) {
        for (const binding of projections.bindings.values)
          bindings.push({
            ...projectionRow(
              contribution,
              command,
              projections.bindings.order,
              commandAvailability,
            ),
            binding,
          });
      }
      if (projections?.palette !== undefined)
        palette.push({
          ...projectionRow(
            contribution,
            command,
            projections.palette.order,
            commandAvailability,
          ),
        });
      if (projections?.slash !== undefined) {
        for (const alias of projections.slash.aliases) {
          let row: WhistleSlashProjection = {
            ...projectionRow(
              contribution,
              command,
              projections.slash.order,
              commandAvailability,
            ),
            alias,
          };
          if (projections.slash.consumesDraft !== undefined)
            row = { ...row, consumesDraft: projections.slash.consumesDraft };
          if (projections.slash.arguments !== undefined)
            row = { ...row, arguments: projections.slash.arguments };
          slash.push(row);
        }
      }
      if (projections?.help !== undefined)
        help.push({
          ...projectionRow(
            contribution,
            command,
            projections.help.order,
            commandAvailability,
          ),
        });
      if (projections?.menu !== undefined)
        menu.push({
          ...projectionRow(
            contribution,
            command,
            projections.menu.order,
            commandAvailability,
          ),
        });
      if (projections?.agent !== undefined)
        agent.push(
          agentRow(
            contribution,
            command,
            projections.agent,
            commandAvailability,
          ),
        );
    }
  }

  sortBindings(bindings);
  sortAliases(slash);
  sortRows(palette);
  sortRows(help);
  sortRows(menu);
  sortRows(agent);

  return Object.freeze({
    bindings: freezeRows(bindings),
    palette: freezeRows(palette),
    slash: freezeRows(slash),
    help: freezeRows(help),
    menu: freezeRows(menu),
    agent: freezeRows(agent),
  });
}

const utf8Encoder = new TextEncoder();

function compareUtf8(left: string, right: string): number {
  const leftBytes = utf8Encoder.encode(left);
  const rightBytes = utf8Encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const leftByte = leftBytes[index] ?? 0;
    const rightByte = rightBytes[index] ?? 0;
    if (leftByte !== rightByte) return leftByte < rightByte ? -1 : 1;
  }
  return leftBytes.length < rightBytes.length
    ? -1
    : leftBytes.length > rightBytes.length
      ? 1
      : 0;
}

function sortRows(rows: WhistleProjectionRow[]): void {
  rows.sort(
    (left, right) =>
      left.order - right.order || compareUtf8(left.commandId, right.commandId),
  );
}

function sortBindings(rows: WhistleBindingProjection[]): void {
  rows.sort(
    (left, right) =>
      left.order - right.order ||
      compareUtf8(left.commandId, right.commandId) ||
      compareUtf8(left.binding, right.binding),
  );
}

function sortAliases(rows: WhistleSlashProjection[]): void {
  rows.sort(
    (left, right) =>
      left.order - right.order ||
      compareUtf8(left.commandId, right.commandId) ||
      compareUtf8(left.alias, right.alias),
  );
}

function freezeRows<T extends WhistleProjectionRow>(rows: T[]): readonly T[] {
  return Object.freeze(rows.map((row) => Object.freeze(row)));
}

function projectionRow(
  contribution: WhistleContribution,
  command: WhistleCommand<never>,
  order: number | undefined,
  availability: WhistleAvailability,
): WhistleProjectionRow {
  const row = unscopedRow(contribution, command, order, availability);
  return contribution.scope === undefined
    ? row
    : { ...row, scope: contribution.scope };
}

function unscopedRow(
  contribution: WhistleContribution,
  command: WhistleCommand<never>,
  order: number | undefined,
  availability: WhistleAvailability,
): Omit<WhistleProjectionRow, "scope"> {
  const row = {
    commandId: `${contribution.namespace}:${command.id}`,
    sourceId: contribution.sourceId,
    title: command.title,
    category: command.category,
    order: order ?? 0,
    availability,
  };
  const described =
    command.description === undefined
      ? row
      : { ...row, description: command.description };
  return command.action === undefined
    ? described
    : { ...described, action: command.action };
}

function agentRow(
  contribution: WhistleContribution,
  command: WhistleCommand<never>,
  projection: NonNullable<WhistleCommandProjections["agent"]>,
  availability: WhistleAvailability,
): WhistleAgentProjection {
  const row = projectionRow(
    contribution,
    command,
    projection.order,
    availability,
  );
  const semanticRow =
    row.action === undefined
      ? row
      : { ...row, action: semanticAction(row.action) };
  return projection.keybind === undefined
    ? semanticRow
    : { ...semanticRow, keybind: projection.keybind };
}

function semanticAction(
  action: WhistleAction,
): Pick<WhistleAction, "inputSchema" | "outputSchema"> {
  const semantic: CopiedAction = {};
  if (action.inputSchema !== undefined)
    semantic.inputSchema = action.inputSchema;
  if (action.outputSchema !== undefined)
    semantic.outputSchema = action.outputSchema;
  return Object.freeze(semantic);
}
