import { normalize } from "./protocol";

type Report = ReturnType<typeof normalize>;
type Station = Report["rows"][number];
type GazeEvent = Report["events"][number] & {
  names: (string | null)[];
  before_exam: boolean;
};
type Session = {
  id: string;
  prepared: number;
  started: number | null;
  freshness: number;
  stations: Map<string, Station>;
  events: Map<string, GazeEvent>;
};

// This module runs in the single lab receiver process shared by the teacher and stations.
let session: Session | null = null;
const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const fail = (msg: string, code: number) => reply({ error: msg }, code);
async function body(req: Request) {
  if (
    !req.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw Error("Send Content-Type application/json.");
  const reader = req.body?.getReader();
  if (!reader) throw Error("A JSON body is required.");
  let size = 0,
    raw = "";
  const dec = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 512000) {
      await reader.cancel();
      throw Error("Report exceeds 500 KB.");
    }
    raw += dec.decode(value, { stream: true });
  }
  try {
    return JSON.parse(raw + dec.decode());
  } catch {
    throw Error("Invalid JSON.");
  }
}
export async function monitor(req: Request, teacher: boolean) {
  if (!teacher) return fail("Open the dashboard on the teacher PC.", 403);
  if (req.method === "POST") {
    let cmd;
    try {
      cmd = await body(req);
    } catch (e) {
      return fail((e as Error).message, 400);
    }
    if (!cmd || typeof cmd !== "object")
      return fail("Invalid exam command.", 400);
    if ((cmd.exam_id ?? null) !== (session?.id ?? null))
      return fail("The exam changed. Refresh and try again.", 409);
    if ((cmd.action === "prepare" || cmd.action === "start") && !session) {
      const now = Date.now();
      session = {
        id: crypto.randomUUID(),
        prepared: now,
        // Accept a direct start from older dashboards as well.
        started: cmd.action === "start" ? now : null,
        freshness: 2000,
        stations: new Map(),
        events: new Map(),
      };
      return reply({ ok: true }, 201);
    }
    if (cmd.action === "start" && session && session.started === null) {
      session.started = Date.now();
      return reply({ ok: true });
    }
    if (cmd.action === "end" && session) {
      session.stations.clear();
      session.events.clear();
      session = null;
      return reply({ ok: true });
    }
    return fail("This action does not match the current exam.", 409);
  }
  if (req.method !== "GET") return fail("Method not supported.", 405);
  const url = new URL(req.url);
  const selected = url.searchParams.get("exam");
  if (selected && selected !== session?.id)
    return fail("Exam is no longer active.", 404);
  const now = Date.now();
  const stations = session
    ? [...session.stations.values()].sort((a, b) =>
        a.pc.localeCompare(b.pc, "en", { numeric: true }),
      )
    : [];
  const offset = Math.max(
    0,
    Math.floor(Number(url.searchParams.get("offset")) || 0),
  );
  const allEvents = session
    ? [...session.events.values()].sort(
        (a, b) => b.occurred - a.occurred || b.id.localeCompare(a.id),
      )
    : [];
  return reply({
    exam: session
      ? {
          id: session.id,
          started: session.started,
          ended: null,
          freshness: session.freshness,
        }
      : null,
    server_time: now,
    event_count: allEvents.length,
    events: allEvents.slice(offset, offset + 100),
    stations: stations.map((p) => {
      const connection =
        p.seen == null
          ? "Never connected"
          : p.stale || now - p.seen > (session?.freshness ?? 2000)
            ? "Stale"
            : "Connected";
      return {
        ...p,
        connection,
        behavior: connection === "Connected" ? p.behavior : null,
      };
    }),
  });
}
export async function ingest(req: Request) {
  const id = new URL(req.url).searchParams.get("exam");
  if (!id) return fail("Use the active exam URL in Connection.", 400);
  if (session?.id !== id) return fail("This exam is closed or unknown.", 409);
  let data;
  try {
    data = normalize(await body(req), Date.now());
  } catch (e) {
    return fail((e as Error).message, 422);
  }
  // Ending the exam while the request body was arriving invalidates the report.
  const active = session;
  if (!active || active.id !== id) return fail("This exam has ended.", 409);
  const now = Date.now();
  if (data.freshness != null) active.freshness = data.freshness;
  for (const r of data.rows) {
    if (r.seen != null && (r.seen < active.prepared || r.seen > now + 30000))
      continue;
    const prev = active.stations.get(r.pc);
    if (prev?.seen != null && (r.seen == null || r.seen < prev.seen)) continue;
    const name = r.name ?? prev?.name ?? null;
    active.stations.set(r.pc, {
      ...r,
      name,
      section: r.section ?? prev?.section ?? null,
      checked: prev?.checked || Number(!!name && r.seen != null),
    });
  }
  for (const e of data.events) {
    if (
      e.occurred < active.prepared ||
      e.occurred > now + 30000 ||
      active.events.has(e.id)
    )
      continue;
    active.events.set(e.id, {
      ...e,
      names: e.pcs.map((pc) => active.stations.get(pc)?.name ?? null),
      before_exam: active.started === null || e.occurred < active.started,
    });
  }
  return reply({ accepted: true, exam_id: id });
}
