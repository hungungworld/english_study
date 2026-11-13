import {readFile, writeFile, mkdir} from "node:fs/promises";
const files = {"index.html":"text/html","style.css":"text/css","app.js":"text/javascript","media.js":"text/javascript","data.js":"text/javascript","config.js":"text/javascript"};
const assets = {};
for (const [name,type] of Object.entries(files)) {
  assets["/" + name] = {type:type + "; charset=utf-8",body:await readFile(new URL("./dist/" + name,import.meta.url),"utf8")};
}
const worker = await readFile(new URL("./media-worker.mjs",import.meta.url),"utf8");
await mkdir(new URL("./dist/server/",import.meta.url),{recursive:true});
await writeFile(new URL("./dist/server/index.js",import.meta.url),worker + "\nexport default handler(" + JSON.stringify(assets) + ");\n");
