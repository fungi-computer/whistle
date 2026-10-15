import {
  createWhistle,
  type WhistleAgentProjection,
  type WhistleBindingProjection,
  type WhistleCommand,
  type WhistleCommandProjections,
  type WhistleContribution,
  type WhistleContributionLease,
  type WhistleExecutionInput,
  type WhistleHelpProjection,
  type WhistleMenuProjection,
  type WhistlePaletteProjection,
  type WhistleRuntime,
  type WhistleSlashProjection,
  type WhistleSnapshot,
} from "@fungi.computer/whistle";
import { parse } from "@fungi.computer/whistle/wire";

const projections: WhistleCommandProjections = {
  bindings: { values: ["ctrl+s"] },
  palette: {},
  slash: { aliases: ["show"] },
  help: {},
  menu: {},
  agent: { keybind: "ctrl+s" },
};
const command: WhistleCommand = {
  id: "show",
  title: "Show",
  category: "navigation",
  projections,
  handler: () => undefined,
};

type SaveArguments = Readonly<{ path: string }>;
type SaveResult = Readonly<{ saved: string }>;
type SaveHandler = WhistleCommand<SaveArguments, SaveResult>["handler"];
const save: SaveHandler = ({ arguments: input }) =>
  input === undefined ? undefined : { saved: input.path };
const saveAsync: SaveHandler = (
  input: WhistleExecutionInput<SaveArguments>,
): Promise<SaveResult | undefined> => Promise.resolve(save(input));
const saveCommand = {
  id: "save",
  title: "Save",
  category: "files",
  handler: save,
} satisfies WhistleCommand<SaveArguments, SaveResult>;
const saveAsyncCommand = {
  ...saveCommand,
  id: "save-async",
  handler: saveAsync,
} satisfies WhistleCommand<SaveArguments, SaveResult>;
const heterogeneous: readonly WhistleCommand<never>[] = [
  command,
  saveCommand,
  saveAsyncCommand,
];
const contribution: WhistleContribution = {
  sourceId: "typed-stranger-source",
  namespace: "typed-stranger",
  commands: heterogeneous,
};
const runtime: WhistleRuntime = createWhistle();
const lease: WhistleContributionLease = runtime.contribute(contribution);
const snapshot: WhistleSnapshot = runtime.snapshot();
const bindings: readonly WhistleBindingProjection[] = snapshot.bindings;
const palette: readonly WhistlePaletteProjection[] = snapshot.palette;
const slash: readonly WhistleSlashProjection[] = snapshot.slash;
const help: readonly WhistleHelpProjection[] = snapshot.help;
const menu: readonly WhistleMenuProjection[] = snapshot.menu;
const agent: readonly WhistleAgentProjection[] = snapshot.agent;
const decoded: readonly WhistleAgentProjection[] = parse(agent);

void lease;
void bindings;
void palette;
void slash;
void help;
void menu;
void agent;
void decoded;

import {
  bindHtmlKeymap,
  type HtmlWhistleBinding,
} from "@fungi.computer/whistle/html";
export function bindConsumer(root: HTMLElement): HtmlWhistleBinding {
  return bindHtmlKeymap(root, runtime, "keyboard");
}
