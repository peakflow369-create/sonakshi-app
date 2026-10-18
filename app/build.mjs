import { build } from "esbuild";
import { copyFileSync, cpSync, mkdirSync } from "node:fs";

mkdirSync("www", { recursive: true });
// static files that are copied as-is (the service worker must stay un-bundled at the web root)
for (const f of ["index.html", "sw.js", "manifest.webmanifest"]) copyFileSync(`src/${f}`, `www/${f}`);
cpSync("src/assets", "www/assets", { recursive: true });

await build({
  entryPoints: ["src/app.js"], bundle: true, minify: true, format: "esm",
  target: "chrome110", outfile: "www/app.js", legalComments: "none",
});
console.log("built -> www/");
