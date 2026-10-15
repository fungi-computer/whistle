import assert from "node:assert/strict";
import { createServer } from "node:http";
import { URL } from "node:url";
import process from "node:process";
import { build, stop } from "esbuild";
import { chromium } from "playwright";
import * as z from "zod";

let server;
let browser;
try {
  const { outputFiles } = await build({
    entryPoints: [new URL("./fixtures/html.ts", import.meta.url).pathname],
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
  });
  const js = outputFiles[0];
  assert.ok(js);
  server = createServer((request, response) => {
    if (request.url === "/proof.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(js.contents);
    } else if (request.url === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(
        '<div id="root" tabindex="0"><button id="update">Update</button><button id="dispose">Dispose</button></div><script type="module" src="/proof.js"></script>',
      );
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = z
    .object({ port: z.number().int().positive() })
    .parse(server.address());
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(10_000);
  const origin = `http://127.0.0.1:${address.port}`;
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  await page.goto(origin);
  await page.locator('[data-ready="true"]').waitFor();
  await page.locator("#root").focus();
  await page.keyboard.press("q");
  await page.locator('[data-count="1"][data-origin="keyboard"]').waitFor();
  assert.equal(await page.locator("#root").getAttribute("data-world"), null);
  await page.keyboard.press("z");
  await page.locator('[data-world="1"]').waitFor();
  await page.locator("#update").click();
  await page.locator("#root").focus();
  await page.keyboard.press("q");
  assert.equal(await page.locator("#root").getAttribute("data-count"), "1");
  await page.locator('[data-world="2"]').waitFor();
  await page.keyboard.press("w");
  await page.locator('[data-count="11"]').waitFor();
  await page.locator("#dispose").click();
  await page.locator("#root").focus();
  await page.keyboard.press("w");
  assert.equal(await page.locator("#root").getAttribute("data-count"), "11");
  await page.keyboard.press("z");
  await page.locator('[data-world="3"]').waitFor();
  await page.keyboard.press("q");
  await page.locator('[data-world="4"]').waitFor();
  assert.deepEqual(errors, []);
  process.stdout.write("HTML keymap keyboard/update/dispose proof PASS\n");
} finally {
  try {
    await browser?.close();
  } finally {
    try {
      if (server?.listening) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    } finally {
      stop();
    }
  }
}
