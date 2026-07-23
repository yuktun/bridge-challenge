import { build, transform } from "esbuild";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "assets");
await mkdir(output, { recursive: true });

const source = await readFile(path.join(root, "src", "participant.js"), "utf8");
const configSource = await readFile(path.join(root, "config.js"), "utf8");
const script = await build({
  stdin: {
    contents: source,
    loader: "js",
    resolveDir: path.join(root, "src"),
    sourcefile: "participant.js"
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  minify: true,
  legalComments: "none",
  treeShaking: true,
  drop: ["console"],
  charset: "utf8",
  write: false,
  plugins: [{
    name: "production-imports",
    setup(build) {
      build.onResolve({ filter: /^https:\/\// }, args => ({
        path: args.path,
        external: true
      }));
      build.onResolve({ filter: /^\.\.\/config\.js$/ }, () => ({
        path: "config.js",
        namespace: "local-config"
      }));
      build.onLoad({ filter: /.*/, namespace: "local-config" }, () => ({
        contents: configSource,
        loader: "js"
      }));
    }
  }]
});
await writeFile(path.join(output, "app.min.js"), script.outputFiles[0].text, "utf8");

const cssSource = await readFile(path.join(root, "styles.css"), "utf8");
const css = await transform(cssSource, {
  loader: "css",
  minify: true,
  legalComments: "none",
  sourcefile: "styles.css"
});
await writeFile(path.join(output, "app.min.css"), css.code, "utf8");
