import { createWhistle } from "../../src/index.js";
import { bindHtmlKeymap } from "../../src/html.js";

const root = document.querySelector<HTMLElement>("#root");
if (root === null) throw new Error("Missing keymap proof root");
const whistle = createWhistle();
let count = 0;
const render = () => {
  root.dataset.count = String(count);
};
const contribution = whistle.contribute({
  sourceId: "html-proof",
  namespace: "proof",
  commands: [
    {
      id: "increment",
      title: "Increment",
      category: "navigation",
      projections: { bindings: { values: ["q"] } },
      handler: ({ origin }) => {
        root.dataset.origin = origin;
        count += 1;
        render();
      },
    },
  ],
});
const binding = bindHtmlKeymap(root, whistle, "keyboard");
binding.keymap.registerLayer({
  priority: -1,
  bindings: [
    { key: "q", cmd: "world" },
    { key: "z", cmd: "world" },
  ],
  commands: [
    {
      name: "world",
      run: () => {
        root.dataset.world = String(Number(root.dataset.world ?? 0) + 1);
        return true;
      },
    },
  ],
});
const update = document.querySelector<HTMLButtonElement>("#update");
const dispose = document.querySelector<HTMLButtonElement>("#dispose");
if (update === null || dispose === null)
  throw new Error("Missing proof controls");
update.onclick = () => {
  contribution.update([
    {
      id: "increment",
      title: "Increment",
      category: "navigation",
      projections: { bindings: { values: ["w"] } },
      handler: () => {
        count += 10;
        render();
      },
    },
  ]);
};
dispose.onclick = () => {
  binding.dispose();
  binding.dispose();
  root.dataset.disposed = "true";
};
render();
root.dataset.ready = "true";
