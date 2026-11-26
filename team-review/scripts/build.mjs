import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
const files = await fs.readdir("public");
const assets = {};
const correctionBundle = await build({entryPoints:["public/corrections.js"],bundle:true,format:"esm",platform:"browser",target:"es2022",write:false});
for (const name of files)
  assets["/" + name] = await fs.readFile(path.join("public", name), "utf8");
assets["/corrections.bundle.js"] = correctionBundle.outputFiles[0].text;
for (const name of ["prepare_dataset.py", "README.md"])
  assets["/training/" + name] = await fs.readFile(
    path.join("training", name),
    "utf8",
  );
await fs.mkdir("generated", { recursive: true });
await fs.writeFile(
  "generated/assets.mjs",
  "export default " + JSON.stringify(assets) + ";",
);
await fs.mkdir("dist/server", { recursive: true });
await fs.mkdir("dist/.openai", { recursive: true });
await build({
  entryPoints: ["worker/index.mjs"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: "dist/server/index.js",
});
await fs.copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
await fs.cp("drizzle", "dist/drizzle", { recursive: true });
console.log("Built Worker, browser assets and database migration.");
