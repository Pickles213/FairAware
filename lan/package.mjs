import { build } from "esbuild";
import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const out = resolve("outputs/lan");
mkdirSync(out, { recursive: true });
await build({
  entryPoints: ["lan/entry.tsx"],
  bundle: true,
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  outfile: out + "/app.js",
  jsx: "automatic",
});
await build({
  entryPoints: ["lib/monitor/server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: out + "/monitor.mjs",
});
for (const [src, dest] of [
  ["lan/server.mjs", "server.mjs"],
  ["lan/START-HERE.txt", "START-HERE.txt"],
  ["public/favicon.svg", "favicon.svg"],
  ["app/globals.css", "app.css"],
])
  copyFileSync(src, out + "/" + dest);
writeFileSync(
  out + "/index.html",
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FairAware · Exam monitor</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js" defer></script></body></html>',
);
execFileSync("python3", [
  "-c",
  'import sys,zipfile,pathlib; d=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED); [z.write(d / f,f) for f in ["index.html","app.css","app.js","favicon.svg","monitor.mjs","server.mjs","START-HERE.txt"]]; z.close()',
  out,
  resolve("public/FairAware-Website.zip"),
]);
