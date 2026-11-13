import {readFile, writeFile, mkdir} from "node:fs/promises";
const files = {"index.html":"text/html","style.css":"text/css","app.js":"text/javascript","media.js":"text/javascript","data.js":"text/javascript","config.js":"text/javascript","favicon.svg":"image/svg+xml","home.js":"text/javascript","pager.js":"text/javascript","design.css":"text/css"};
const assets = {};
for (const [name,type] of Object.entries(files)) {
  assets["/" + name] = {type:type + "; charset=utf-8",body:await readFile(new URL("./dist/" + name,import.meta.url),"utf8")};
}
const binary = {"img/tv-pile.jpg":"image/jpeg"};
for (const [name,type] of Object.entries(binary)) {
  assets["/" + name] = {type,base64:true,body:(await readFile(new URL("./dist/" + name,import.meta.url))).toString("base64")};
}
// Dev only: the design audit is served by the local dev server and never deployed (Vercel serves dist/ only).
assets["/__design-audit.js"] = {type:"text/javascript; charset=utf-8",body:await readFile(new URL("./tools/design-audit.js",import.meta.url),"utf8")};
const worker = await readFile(new URL("./media-worker.mjs",import.meta.url),"utf8");
await mkdir(new URL("./dist/server/",import.meta.url),{recursive:true});
await writeFile(new URL("./dist/server/index.js",import.meta.url),worker + "\nexport default handler(" + JSON.stringify(assets) + ");\n");
