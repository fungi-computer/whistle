import type {
  WhistleExecutionOrigin,
  WhistleExecutionOutcome,
  WhistleRuntime,
} from "./index.js";

/** Lifecycle operations for a projection into a maintained host keymap. */
export type WhistleKeymapAdapter = Readonly<{
  /** Remove the projected layer from the host. */
  cleanup: () => void;
}>;

/** One physical key string mapped to a Whistle command identifier. */
export type WhistleKeymapBinding = Readonly<{
  /** Whistle command identifier. */
  cmd: string;
  /** Host key notation. */
  key: string;
}>;

/** Host callback that executes one semantic Whistle command. */
export type WhistleKeymapCommand = Readonly<{
  /** Whistle command identifier. */
  name: string;
  /** Execute the command and report whether the host handled it. */
  run: () => Promise<boolean>;
}>;

/** Binding and command records accepted by a maintained keymap host. */
export type WhistleKeymapLayer = Readonly<{
  /** Physical bindings mapped to Whistle command identifiers. */
  bindings: readonly WhistleKeymapBinding[];
  /** Host callbacks that execute the semantic commands. */
  commands: readonly WhistleKeymapCommand[];
}>;

/** Minimal registration surface implemented by a maintained host keymap. */
export type WhistleKeymapHost = Readonly<{
  /** Register one projected layer and return its disposal function. */
  registerLayer: (layer: WhistleKeymapLayer) => () => void;
}>;

/** Project Whistle bindings into a host-created maintained OpenTUI keymap. */
export function createWhistleKeymapAdapter(
  keymap: WhistleKeymapHost,
  whistle: Pick<WhistleRuntime, "snapshot" | "subscribe" | "execute">,
  origin: WhistleExecutionOrigin,
): WhistleKeymapAdapter {
  const hostKeymap = keymap;
  let dispose: () => void = () => undefined;
  let cleaned = false;
  const update = () => {
    if (cleaned) return;
    dispose();
    const snapshot = whistle.snapshot();
    const commandIds = new Set(snapshot.bindings.map((row) => row.commandId));
    const bindings = snapshot.bindings.map((row) => ({
      cmd: row.commandId,
      key: row.binding,
    }));
    const commands = [...commandIds].map((commandId) => ({
      name: commandId,
      run: () => whistle.execute(commandId, { origin }).then(executionResult),
    }));
    dispose = hostKeymap.registerLayer({ bindings, commands });
  };
  update();
  const unsubscribe = whistle.subscribe(update);
  return Object.freeze({
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      unsubscribe();
      dispose();
    },
  });
}

function executionResult(outcome: WhistleExecutionOutcome): boolean {
  return outcome.status === "handled";
}
