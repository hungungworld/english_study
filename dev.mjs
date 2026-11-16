import {createServer} from "node:http";
import {loadEnvFile} from "node:process";
import worker from "./dist/server/index.js";

try { loadEnvFile(); }
catch (error) { if (error.code !== "ENOENT") throw error; }

createServer(async (incoming,outgoing) => {
  try {
    const chunks = [];
    if (incoming.method === "POST") for await (const chunk of incoming) chunks.push(chunk);
    const request = new Request(new URL(incoming.url,"http://localhost:8000"),{method:incoming.method,...(chunks.length ? {body:Buffer.concat(chunks)} : {})});
    const response = await worker.fetch(request,process.env);
    outgoing.writeHead(response.status,Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500).end("Request failed");
  }
}).listen(8000,"127.0.0.1",() => console.log("http://127.0.0.1:8000"));
