import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { ingest, monitor } from "./monitor.mjs";

const base = fileURLToPath(new URL("./", import.meta.url));
const data = process.env.FAIRAWARE_DATA || join(base, "data");
mkdirSync(data, { recursive: true, mode: 0o700 });
const keyFile = join(data, "report-key.txt");
if (!existsSync(keyFile))
  writeFileSync(keyFile, randomBytes(32).toString("hex"), {
    flag: "wx",
    mode: 0o600,
  });
const key = readFileSync(keyFile, "utf8").trim();
const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "application/javascript"]],
  ["/app.css", ["app.css", "text/css"]],
  ["/favicon.svg", ["favicon.svg", "image/svg+xml"]],
]);
let lanIPs = [];
try {
  lanIPs = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
} catch {
  console.warn(
    "Could not detect a LAN address. Replace localhost in the report URL with the teacher PC address.",
  );
}
const port = Number(process.env.FAIRAWARE_PORT || 8766);
const authorized = (v) => {
  const a = Buffer.from(v || ""),
    b = Buffer.from("Bearer " + key);
  return a.length === b.length && timingSafeEqual(a, b);
};
const send = (out, status, data) => {
  out.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  out.end(JSON.stringify(data));
};
http
  .createServer(async (incoming, out) => {
    try {
      const host = incoming.headers.host || "localhost";
      const url = new URL(incoming.url, "http://" + host);
      const teacher =
        ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
          incoming.socket.remoteAddress,
        ) && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
      const browserOrigin = incoming.headers.origin;
      const hostedOrigin =
        "https://fairaware-exam-monitor.ruralthyme8.chatgpt.site";
      if (browserOrigin && browserOrigin !== url.origin) {
        const teacherRoute = ["/deployment-info.json", "/api/monitor"].includes(
          url.pathname,
        );
        if (!teacher || browserOrigin !== hostedOrigin || !teacherRoute) {
          return send(out, 403, {
            error: "Use the teacher dashboard on the teacher PC.",
          });
        }
        out.setHeader("Access-Control-Allow-Origin", hostedOrigin);
        out.setHeader("Vary", "Origin");
        out.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        out.setHeader("Access-Control-Allow-Headers", "Content-Type");
        out.setHeader("Access-Control-Allow-Private-Network", "true");
        if (incoming.method === "OPTIONS") {
          out.writeHead(204);
          out.end();
          return;
        }
      }
      const path = url.pathname,
        method = incoming.method;
      if (path === "/api/reports") {
        if (method !== "POST") return send(out, 405, { error: "Use POST." });
        if (!authorized(incoming.headers.authorization))
          return send(out, 401, { error: "A valid report key is required." });
      } else if (!teacher)
        return send(out, 403, {
          error:
            "Open the teacher dashboard on the teacher PC using localhost.",
        });
      if (path === "/api/reports" || path === "/api/monitor") {
        const init = { method, headers: incoming.headers };
        if (method !== "GET" && method !== "HEAD") {
          init.body = Readable.toWeb(incoming);
          init.duplex = "half";
        }
        const req = new Request(url, init);
        const res =
          path === "/api/reports"
            ? await ingest(req)
            : await monitor(req, teacher);
        out.writeHead(res.status, Object.fromEntries(res.headers));
        out.end(await res.text());
        return;
      }
      if (path === "/deployment-info.json")
        return send(out, 200, {
          mode: "lan",
          storage: "memory",
          exam_preparation: true,
          port,
          station_origin: lanIPs.length
            ? "http://" + lanIPs[0] + ":" + port
            : "",
        });
      if (method !== "GET" || !assets.has(path))
        return send(out, 404, { error: "Not found" });
      const [file, type] = assets.get(path);
      out.writeHead(200, {
        "content-type": type,
        "x-content-type-options": "nosniff",
        "cache-control": "no-cache",
      });
      out.end(readFileSync(join(base, file)));
    } catch (e) {
      console.error("Website request could not be processed.");
      if (!out.headersSent) send(out, 500, { error: "Request failed." });
      else out.end();
    }
  })
  .listen(port, "0.0.0.0", () => {
    console.log("FairAware teacher website: http://localhost:" + port);
    console.log(
      "Local station addresses: " +
        lanIPs.map((ip) => "http://" + ip + ":" + port).join(", "),
    );
    console.log(
      "Use the report key stored in " +
        keyFile +
        " for the station Authorization header.",
    );
  });
