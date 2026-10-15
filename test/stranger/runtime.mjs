import { createWhistle } from "@fungi.computer/whistle";
import { parse } from "@fungi.computer/whistle/wire";

let calls = 0;
const runtime = createWhistle();
const lease = runtime.contribute({
  sourceId: "stranger-source",
  namespace: "stranger",
  commands: [
    {
      id: "show",
      title: "Show Things",
      category: "navigation",
      description: "Show the things",
      projections: {
        bindings: { values: ["ctrl+shift+s"], order: 10 },
        palette: { order: 20 },
        slash: { aliases: ["show"], order: 30 },
        help: { order: 40 },
        menu: { order: 50 },
        agent: { keybind: "ctrl+shift+s", order: 60 },
      },
      handler: () => {
        calls += 1;
      },
    },
  ],
});

const snapshot = runtime.snapshot();
const agentProjection = parse(JSON.parse(JSON.stringify(snapshot.agent)));
if (agentProjection[0]?.commandId !== "stranger:show")
  throw new Error("wire parser did not decode the packed agent projection");
if (!Object.isFrozen(snapshot)) throw new Error("snapshot is mutable");
for (const rows of Object.values(snapshot)) {
  if (!Object.isFrozen(rows) || rows.length !== 1)
    throw new Error("snapshot rows are not immutable or complete");
  const row = rows[0];
  if (row === undefined || row.commandId !== "stranger:show")
    throw new Error("snapshot row has the wrong canonical command ID");
}
if (
  snapshot.bindings[0]?.binding !== "ctrl+shift+s" ||
  snapshot.slash[0]?.alias !== "show" ||
  snapshot.agent[0]?.keybind !== "ctrl+shift+s" ||
  snapshot.palette[0]?.title !== "Show Things" ||
  snapshot.help[0]?.category !== "navigation" ||
  snapshot.menu[0]?.description !== "Show the things"
)
  throw new Error("snapshot projections are incomplete");
if (calls !== 0) throw new Error("snapshot evaluation called the handler");

lease.dispose();
if (Object.values(runtime.snapshot()).some((rows) => rows.length !== 0))
  throw new Error("disposing the contribution left projection rows");

// Node exercises the packed entry import; the local browser proof owns DOM calls.
export { bindHtmlKeymap } from "@fungi.computer/whistle/html";
