import { createWhistle } from "@fungi.computer/whistle";

const whistle = createWhistle();
whistle.contribute({
  sourceId: "editor",
  namespace: "editor",
  commands: [
    {
      id: "save",
      title: "Save file",
      category: "File",
      handler: () => ({ saved: true }),
    },
  ],
});
const outcome = await whistle.execute("editor:save", { origin: "palette" });
if (outcome.status === "handled") console.log(outcome.result); // { saved: true }
whistle.close();
