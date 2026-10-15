import { createDefaultHtmlKeymap } from "@opentui/keymap/html";
import {
  createWhistleKeymapAdapter,
  type WhistleExecutionOrigin,
  type WhistleRuntime,
} from "./index.js";

/** Maintained document keymap plus disposable Whistle command projection. */
export type HtmlWhistleBinding = Readonly<{
  /** The host keymap, also available for the application's other layers. */
  keymap: ReturnType<typeof createDefaultHtmlKeymap>;
  /** Remove Whistle's layer and subscription; the HTML host belongs to the document. */
  dispose: () => void;
}>;

/**
 * Bind Whistle commands to the maintained OpenTUI HTML keymap. The root owns
 * the host's document lifetime; dispose removes the command projection only.
 */
export function bindHtmlKeymap(
  root: HTMLElement,
  whistle: Pick<WhistleRuntime, "snapshot" | "subscribe" | "execute">,
  origin: WhistleExecutionOrigin,
): HtmlWhistleBinding {
  const keymap = createDefaultHtmlKeymap(root);
  const adapter = createWhistleKeymapAdapter(keymap, whistle, origin);
  return { keymap, dispose: adapter.cleanup };
}
