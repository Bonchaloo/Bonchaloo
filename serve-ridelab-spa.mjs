import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(process.argv[2] || "ridelab-operations-dist");
const port = Number(process.env.PORT || 10000);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function safePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]).replace(/^\/+/, "");
  const resolved = path.resolve(root, clean || "index.html");
  return resolved.startsWith(root + path.sep) || resolved === path.join(root, "index.html") ? resolved : null;
}

function sendFile(res, file) {
  const type = contentTypes[path.extname(file).toLowerCase()] || "application/octet-stream";
  res.statusCode = 200;
  res.setHeader("Content-Type", type);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", path.basename(file) === "index.html" ? "no-cache" : "public, max-age=3600");
  fs.createReadStream(file).pipe(res);
}

http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    return res.end("Method Not Allowed");
  }

  let candidate;
  try { candidate = safePath(req.url || "/"); }
  catch { candidate = null; }

  if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    if (req.method === "HEAD") { res.statusCode = 200; return res.end(); }
    return sendFile(res, candidate);
  }

  // BrowserRouter deep links (/login, /service-orders/:id, /owner/...) all
  // resolve to the same React entry point instead of Render's plain 404.
  const index = path.join(root, "index.html");
  if (fs.existsSync(index)) {
    if (req.method === "HEAD") { res.statusCode = 200; return res.end(); }
    return sendFile(res, index);
  }

  res.statusCode = 503;
  res.end("Ride Lab Operations artifact missing");
}).listen(port, "0.0.0.0", () => {
  console.log(`Ride Lab Operations SPA listening on ${port}; root=${root}`);
});
