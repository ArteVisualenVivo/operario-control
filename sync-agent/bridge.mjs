// Puente local del agente 3C (solo esta PC).
// La web de Vercel NO puede hacer spawn aca: este puente escucha SOLO en
// 127.0.0.1:3033 y despierta al agente AL INSTANTE cuando el navegador esta
// en la PC de 3C. Si el navegador esta en otra PC/celular, el fetch falla y
// se usa el camino anterior (cola + despertador <1 min).
// Solo despierta si hay trabajo real en Redis (o force:true local).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const LOCK_FILE = path.join(ROOT, "sync-agent", ".agent.lock");
const AGENT_TS = path.join(ROOT, "sync-agent", "agent.ts");
const ENV_FILE = path.join(ROOT, ".env.local");
const PORT = Number(process.env.PORT || 3033);

function readEnv(name) {
  try {
    const raw = fs.readFileSync(ENV_FILE, "utf-8");
    const m = raw.match(new RegExp("^" + name + "=(.*)$", "m"));
    if (!m) return "";
    return m[1].trim().replace(/^["']|["']$/g, "");
  } catch { return ""; }
}

async function redisCall(cmd) {
  const url = process.env.UPSTASH_REDIS_REST_URL || readEnv("UPSTASH_REDIS_REST_URL");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || readEnv("UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token) return null;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.result ?? null;
}

function readLockPid() {
  try {
    if (!fs.existsSync(LOCK_FILE)) return null;
    const pid = Number(JSON.parse(fs.readFileSync(LOCK_FILE, "utf-8"))?.pid);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}

function agentAlive() {
  const pid = readLockPid();
  if (pid === null) return { alive: false, pid: null };
  try {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`],
      { timeout: 8000 }).toString().trim();
    return out === String(pid) ? { alive: true, pid } : { alive: false, pid: null };
  } catch { return { alive: false, pid: null }; }
}
async function queueLen() {
  try {
    const v = Number(await redisCall(["LLEN", "sync-3c:queue"]));
    return Number.isInteger(v) && v >= 0 ? v : -1;
  } catch { return -1; }
}
async function cmdVivo(id) {
  if (!id || typeof id !== "string") return false;
  try {
    const s = await redisCall(["HGET", `sync-3c:command:${id}`, "status"]);
    return s === "pending" || s === "running";
  } catch { return false; }
}
function lanzar(argv) {
  const c = spawn("npx", ["tsx", AGENT_TS, ...argv], {
    cwd: ROOT, windowsHide: true, shell: true, detached: true, stdio: "ignore",
  });
  c.unref();
  return c.pid ?? null;
}
function resp(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type", "Content-Length": Buffer.byteLength(b) });
  res.end(b);
}
const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type" });
    res.end(); return;
  }
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/health") {
    const a = agentAlive(); const q = await queueLen();
    resp(res, 200, { ok: true, agent: a.alive ? "running" : "idle", pid: a.pid, queue: q });
    return;
  }
  if (req.method === "POST" && url.pathname === "/wake") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 8192) req.destroy(); });
    req.on("end", async () => {
      let d = {};
      try { d = body ? JSON.parse(body) : {}; } catch { d = {}; }
      const a = agentAlive();
      if (a.alive) { resp(res, 200, { ok: true, alreadyRunning: true, pid: a.pid }); return; }
      const q = await queueLen();
      const hayTrabajo = q > 0 || (await cmdVivo(d?.commandId)) || d?.force === true;
      if (!hayTrabajo) { resp(res, 200, { ok: true, empty: true, queue: q }); return; }
      try { if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE); } catch {}
      const argv = [];
      if (typeof d?.commandId === "string" && d.commandId) argv.push(d.commandId);
      if (typeof d?.module === "string" && d.module) argv.push(d.module);
      if (Array.isArray(d?.autoEnqueued)) for (const id of d.autoEnqueued) {
        if (typeof id === "string" && id) argv.push(id);
      }
      const pid = lanzar(argv);
      console.log(`[BRIDGE] wake pid=${pid} args=${argv.length} cola=${q}`);
      resp(res, 200, { ok: true, started: true, pid, queue: q });
    });
    return;
  }
  resp(res, 404, { ok: false, error: "not-found" });
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`[BRIDGE] escuchando en http://127.0.0.1:${PORT} (solo esta PC)`);
});
