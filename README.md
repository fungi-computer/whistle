# Whistle (`@fungi.computer/whistle`)

Whistle is a typed command graph for apps that expose the same actions in many
places. You write one command definition. Whistle derives six immutable views
from it: key bindings, command palette, slash commands, help, menu, and an agent
view for AI tools. Every caller, from a key press to an agent, runs the command
through one typed `execute` door and gets one typed outcome back.

Use it when a keyboard shortcut, a palette entry, a `/slash` command and an
agent tool should all mean the same action, show the same availability, and fail
the same way. Whistle owns the command graph. Your host keeps key matching,
rendering, transport, authorization, and the real work.

## Install or set up

```sh
npm install @fungi.computer/whistle
```

Whistle is an ESM package with Zod as its only runtime dependency. It runs in
Node, browsers, and Workers. It has five entrypoints:

- `@fungi.computer/whistle`: the runtime, `scopeSnapshot`, the keymap adapter,
  and the command types.
- `@fungi.computer/whistle/wire`: Zod schemas and parsers for command
  definitions, prompts, notices, and prompt answers.
- `@fungi.computer/whistle/interaction`: a renderer-neutral interaction store.
- `@fungi.computer/whistle/catalog`: parses a backend's `whistle.catalog/v1`
  command catalog and turns it into commands.

- `@fungi.computer/whistle/html`: binds command projections to a DOM keymap.
  HTML users install the optional peer `@opentui/keymap@0.5.10`; core users do
  not need it.

## Quick start

This creates a runtime, contributes one command to the palette and slash
surfaces, reads the snapshot, and runs the command:

```ts
import { createWhistle } from "@fungi.computer/whistle";

const whistle = createWhistle();

const lease = whistle.contribute({
  sourceId: "editor",
  namespace: "editor",
  commands: [
    {
      id: "save",
      title: "Save file",
      category: "File",
      projections: {
        palette: {},
        slash: { aliases: ["save"] },
        bindings: { values: ["mod+s"] },
      },
      handler: () => ({ saved: true }),
    },
  ],
});

const snapshot = whistle.snapshot();
console.log(snapshot.palette.map((row) => row.commandId)); // ["editor:save"]
console.log(snapshot.slash.map((row) => row.alias)); // ["save"]

const outcome = await whistle.execute("editor:save", { origin: "palette" });
if (outcome.status === "handled") console.log(outcome.result); // { saved: true }

lease.dispose();
whistle.close();
```

A command's canonical ID is `<namespace>:<id>`. Every projection row carries
that ID, so a palette click, a key press and a slash command all call the same
`execute`.

### Bind a browser keyboard

```sh
npm install @opentui/keymap@0.5.10
```

```ts
import { createWhistle } from "@fungi.computer/whistle";
import { bindHtmlKeymap } from "@fungi.computer/whistle/html";

const whistle = createWhistle();
whistle.contribute({
  sourceId: "browser",
  namespace: "browser",
  commands: [
    {
      id: "save",
      title: "Save",
      category: "File",
      projections: { bindings: { values: ["mod+s"] } },
      handler: () => ({ saved: true }),
    },
  ],
});
const keyboard = bindHtmlKeymap(document.body, whistle, "keyboard");
// Contributions and availability updates refresh the projected key layer.
keyboard.dispose();
whistle.close();
```

`dispose` removes the Whistle layer and subscription, and can be called twice.
The underlying HTML keymap host follows the document's lifetime; this helper
does not remove its DOM listeners. Commands still execute through Whistle.

## Core concepts

### Commands, contributions and leases

A command has an `id`, a `title`, a `category`, an optional `description`, a
`handler`, and optional `projections`, `action` and `availability`. A command
shows up only on the surfaces its `projections` name.

`contribute` admits a batch of commands from one `sourceId` into one
`namespace`, optionally inside a focus `scope` such as one open window.
Admission is atomic: the whole contribution is validated before any of it goes
live. It throws when a namespace already belongs to another source, when a
canonical ID or a slash alias in the same scope repeats, or when a field is
blank.

Each contribution returns a lease for that exact generation. `lease.update`
swaps its commands atomically. `lease.dispose` removes it. Disposing a stale
lease never removes a replacement. Both calls are idempotent.

### Snapshots and projections

`snapshot()` returns six frozen arrays: `bindings`, `palette`, `slash`, `help`,
`menu` and `agent`. Rows are immutable copies. Each surface sorts by its
explicit `order`, then by command ID in UTF-8 byte order, so the order never
depends on insertion. A snapshot keeps its identity until the graph or some
availability changes. `subscribe(listener)` tells you when the graph changes.

The agent view drops `presentation` metadata and keeps the semantic
`inputSchema` and `outputSchema`, so an agent gets a tool description and never
a UI layout. `scopeSnapshot(snapshot, scope)` gives the human and agent view for
one focused scope: global rows plus that scope's rows, with a focused slash
alias or binding shadowing the same global one. Agent rows carry their scope and
follow the same filter. The complete runtime snapshot still lists all scopes.

### Execution

`execute(commandId, input)` is the only way a handler runs. `input.origin` is
one of eight closed origins: `agent`, `browser`, `keyboard`, `menu`, `palette`,
`programmatic`, `slash` and `terminal`. The outcome is one of:

- `handled`: the handler finished. Its return value is in `result`. This does
  not mean physical work or a durable workflow completed.
- `unavailable`: the command's `availability()` said no. The reason comes back.
- `failed`: the handler threw. `error` is JSON: `{ code, message, details? }`.
- `missing`: no live command has that ID.
- `invalid`: the command ID is blank.
- `closed`: the runtime was closed first.

### Availability

A command can supply a synchronous `availability()` reader over current host
facts. `snapshot()` keeps unavailable commands visible with their reason, and
`execute()` reads availability again right before calling the handler.
Availability is a convenience check. It is not authorization, so the handler
still admits the real request. The host updates its own facts and publishes
snapshots over its own connection. Whistle does no polling or broadcast.

### Failures

Throw `WhistleActionError(code, message, details?)` to choose the failure code
and attach JSON details. Any other `Error` becomes `command_failed`. Stacks and
non-Error thrown values never cross the execution result.

### Interactions

A running command can talk to its human caller through `input.interaction`.
`prompt` asks one `choice`, `text` (optionally `secret`) or `confirmation`
question. `notify` shows `info`, `progress`, `handoff` (open a URL, optionally
enter a code) or `success`. The vocabulary names the kind of answer, never a
widget.

A caller can pass its own interaction. Otherwise `present(presenter)` registers
the mounted client that opens one for each human-origin execution. Agent and
programmatic executions get none. Whistle settles the session with `handled`,
`cancelled` or `failed` when the handler ends. The newest presenter wins until
its disposer runs.

`createWhistleInteractionHost` from `./interaction` is a renderer-neutral store
for one interaction. It parses every prompt, notice and answer with the `./wire`
schemas, and a terminal or browser renderer draws its snapshot.

After an answer or Try again, the host reuses the current progress message, or
the command title when the producer supplies none, in the existing running row.
This does not open a conversation for an inline operation that never asked a
question or showed progress/a handoff.

`interaction.run(operation)` marks one serial operation as retryable. Once the
conversation has asked a question or shown progress/a handoff, a failure is
shown and waits for `host.retry()` or dismissal. Before that, it propagates
normally: a failed inline action does not suddenly open a conversation. Retry
repeats only that operation with its captured inputs; the original handler stays
suspended, so successful earlier steps and questions are not replayed. Dismissal
aborts that wait. Failures outside `run` end the handler normally and do not
advertise a whole-command replay fallback. Notification-only interactions
execute `run` once and propagate failure, without an interactive retry wait.

### Slash arguments

A slash projection can carry `arguments`, a data-only grammar for the text after
the alias. Fixed `words` map to complete argument objects. `text` puts the rest
of the line into one field of a fixed argument object, optionally with a request
ID field for idempotent retries. Clients parse, complete and hint from this
data, so no client names a command in code.

### Catalogs

A backend advertises its commands as a `whistle.catalog/v1` catalog of the same
data-only definitions. `parseCatalog` validates it at the client boundary.
`catalogCommands(catalog, invoke)` turns it into commands whose handlers call
your `invoke` function. Each reply is a step: `done` (optional notice and
result) or `prompt` (one question plus the complete arguments of the next call,
with the answer going into a named field). Multi-step flows stay stateless on
the wire and run through the caller's interaction. Each catalog invocation is
one retryable operation. Non-secret answers and request identity are retained;
secret answers are not. The continuation keeps the secret questions instead,
asks them inside each attempt, and removes their values from the invocation
payload as soon as it settles, whether it succeeds or fails. Retry re-asks only
those secret questions, not earlier non-secret choices. If a later backend step
still requires a secret, it must be entered again for that invocation too.

### Closing

`close()` is synchronous and idempotent and returns `undefined`. The first call
releases every live contribution and leaves the shared empty snapshot. Leases
issued earlier become harmless. An `execute` Promise returned before `close`
still settles, and may settle `handled`. A later `execute` returns `closed`, and
a later valid `contribute` throws `WhistleClosedError`.

### Typing a reusable handler

Use indexed access on `WhistleCommand` to declare a handler apart from a command
literal:

```ts
import type { WhistleCommand } from "@fungi.computer/whistle";

type SaveArguments = Readonly<{ path: string }>;
type SaveResult = Readonly<{ saved: string }>;

const save: WhistleCommand<SaveArguments, SaveResult>["handler"] = ({
  arguments: input,
}) => (input === undefined ? undefined : { saved: input.path });
```

The handler receives `WhistleExecutionInput<SaveArguments>`: the origin,
optional arguments, a cancellation signal and an optional interaction. It
returns `SaveResult`, `undefined`, or a Promise of either.
`WhistleCommandHandler` names this callback type. Commands with different
argument and result types can share one `readonly WhistleCommand<never>[]`
contribution. Contributions erase those generics at runtime, so the handler
still validates the arguments it actually gets.

### Presentation hints

`action.inputSchema` and `action.outputSchema` describe structured data and keep
opaque JSON annotations. `action.presentation` is an optional local hint:
`action`, `choice`, `form`, `confirmation`, or `custom` with opaque JSON for an
owning client's own field or gesture bindings. A server capability must not
prescribe its form, menu or other rendering. Human projections keep the hint.
The agent projection drops it.

## API reference

See the generated [API reference](docs/api/README.md). It covers the root
entrypoint and the `wire`, `interaction` and `catalog` subpaths.

## Examples

### Show a command as unavailable

```ts
import { createWhistle } from "@fungi.computer/whistle";

let signedIn = false;
const whistle = createWhistle();
whistle.contribute({
  sourceId: "account",
  namespace: "account",
  commands: [
    {
      id: "sync",
      title: "Sync now",
      category: "Account",
      projections: { palette: {}, agent: {} },
      availability: () =>
        signedIn
          ? { status: "available" }
          : { status: "unavailable", reason: "Sign in first." },
      handler: () => undefined,
    },
  ],
});

console.log(whistle.snapshot().palette[0]?.availability);
// { status: "unavailable", reason: "Sign in first." }
console.log(await whistle.execute("account:sync", { origin: "agent" }));
// { status: "unavailable", reason: "Sign in first." }
signedIn = true;
```

### Fail with a code

```ts
import { WhistleActionError, createWhistle } from "@fungi.computer/whistle";

const whistle = createWhistle();
whistle.contribute({
  sourceId: "files",
  namespace: "files",
  commands: [
    {
      id: "open",
      title: "Open file",
      category: "File",
      handler: () => {
        throw new WhistleActionError("not_found", "No such file", {
          path: "a.txt",
        });
      },
    },
  ],
});

const outcome = await whistle.execute("files:open", { origin: "terminal" });
// { status: "failed", error: { code: "not_found", message: "No such file", details: { path: "a.txt" } } }
```

### Load a backend catalog

```ts
import { createWhistle } from "@fungi.computer/whistle";
import { catalogCommands, parseCatalog } from "@fungi.computer/whistle/catalog";

const catalog = parseCatalog(await (await fetch("/commands")).json());
const whistle = createWhistle();
whistle.contribute({
  sourceId: "backend",
  namespace: "backend",
  commands: catalogCommands(catalog, async (commandId, args, signal) => {
    const response = await fetch(`/commands/${commandId}`, {
      method: "POST",
      body: JSON.stringify(args),
      signal,
    });
    return response.json();
  }),
});
```

### Checks

From a checkout, the unit tests cover the runtime, wire schemas, interaction
host and catalog:

```sh
pnpm --filter @fungi.computer/whistle test
```

## Limits and errors

- A runtime holds at most 64 live contributions and 256 live commands.
- A command has at most 16 binding values and 16 slash aliases. A slash grammar
  has at most 32 words.
- A catalog has at most 128 commands, and a catalog flow stops after 16 steps
  with `flow_too_long`. A catalog command that needs a prompt fails with
  `interaction_required` when there is no interaction, which is always the case
  for agent and programmatic origins.
- Prompt and notice text is capped at 8192 characters. A choice prompt has 1 to
  256 options. Notice URLs must be `http` or `https`.
- Namespaces must not contain a colon, and command IDs, titles, categories and
  labels must not be blank. Violations throw a plain `Error` from `contribute`
  or `lease.update`.
- These bounds are defenses inside the implementation. They are not stable API
  promises.

Whistle does not parse key presses or slash input from raw text, render UI, run
transport, or keep durable delivery state. It owns no browser, terminal, DOM,
React, product or authorization state, and has no timers or background work. Use
the `./wire` parsers on untrusted input before it becomes a command, prompt or
notice.

## Contribute and license

MIT. See [LICENSE](./LICENSE).
