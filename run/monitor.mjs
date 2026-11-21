// lib/monitor/protocol.ts
var behaviors = ["Normal", "Alert", "Suspicious behavior"];
var object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var tag = (v) => typeof v === "string" ? v.trim().toLowerCase().replace(/[ -]+/g, "_") : "";
function limited(v, max) {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || v.length > max)
    throw Error("A text field exceeds its limit or has the wrong type.");
  return v.trim() || null;
}
function pcId(v) {
  const s = limited(v, 48);
  if (!s || !/^[a-z0-9][a-z0-9 _.-]*$/i.test(s))
    throw Error("Each station needs a valid PC identifier.");
  return s;
}
function stamp(v) {
  if (typeof v !== "string" || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(v) || !Number.isFinite(Date.parse(v)))
    throw Error("Use an ISO timestamp with a timezone.");
  return Date.parse(v);
}
function normalize(payload, now) {
  if (!object(payload) || !object(payload.stations))
    throw Error("Supply a JSON object containing a stations map.");
  const entries = Object.entries(payload.stations);
  if (entries.length > 200)
    throw Error("Send at most 200 stations per request.");
  const seconds = payload.freshness_timeout_seconds;
  if (seconds != null && (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0 || seconds > 600))
    throw Error("Invalid freshness timeout.");
  const rows = entries.map(([key, v]) => {
    const pc = pcId(key);
    if (!object(v)) throw Error("Invalid station object.");
    if (v.report != null && !object(v.report))
      throw Error("A station report must be an object or null.");
    const r = object(v.report) ? v.report : null;
    const name = limited(v.Name ?? v.name ?? r?.name, 100), section = limited(v.section ?? v.Section ?? r?.section, 80);
    const idle = tag(v.status) === "never_connected";
    const value = r?.behavior_status ?? r?.behavior ?? r?.status ?? v.behavior_status;
    const behavior = behaviors.find((b) => tag(b) === tag(value)) ?? null;
    const seen = idle ? null : v.received_at_utc != null ? stamp(v.received_at_utc) : r ? now : null;
    return {
      pc,
      name,
      section,
      seen,
      behavior: seen == null ? null : behavior,
      stale: Number(v.stale === true || tag(v.status) === "stale"),
      checked: Number(!!name && seen != null)
    };
  });
  const found = /* @__PURE__ */ new Map();
  function add(v, kindValue, stationsValue) {
    if (!object(v)) throw Error("Each event must be an object.");
    const k = tag(v.type ?? v.kind ?? v.event_type ?? kindValue);
    if (k !== "individual_lateral_gaze" && k !== "reciprocal_gaze")
      throw Error("Unknown event type.");
    const raw = v.stations ?? v.station ?? v.station_id ?? stationsValue;
    const pcs = (Array.isArray(raw) ? raw : [raw]).map(pcId).sort();
    if (new Set(pcs).size !== pcs.length || pcs.length !== (k === "reciprocal_gaze" ? 2 : 1))
      throw Error("The event has an invalid station count.");
    const occurred = stamp(
      v.occurred_at_utc ?? v.first_observed_at_utc ?? v.started_at_utc ?? v.timestamp_utc
    );
    const id = limited(v.event_id ?? v.id, 160) ?? JSON.stringify([k, pcs, occurred]);
    found.set(id, { id, kind: k, pcs, occurred });
  }
  if (payload.events != null && !Array.isArray(payload.events))
    throw Error("events must be an array.");
  for (const v of payload.events ?? [])
    add(v, void 0, void 0);
  if (object(payload.individual_lateral_gaze)) {
    for (const [pc, v] of Object.entries(payload.individual_lateral_gaze)) {
      if (!object(v)) continue;
      if (object(v.event))
        add({ ...v, ...v.event }, "individual_lateral_gaze", pc);
      else if (v.state === "active" && v.first_observed_at_utc)
        add(v, "individual_lateral_gaze", pc);
    }
  }
  const reciprocal = payload.reciprocal_gaze;
  if (object(reciprocal) && Array.isArray(reciprocal.pairs)) {
    for (const v of reciprocal.pairs) {
      if (!object(v)) continue;
      if (object(v.event))
        add({ ...v, ...v.event }, "reciprocal_gaze", v.stations);
      else if (v.state === "active" && v.first_observed_at_utc)
        add(v, "reciprocal_gaze", v.stations);
    }
  }
  if (found.size > 100) throw Error("Send at most 100 events per request.");
  return {
    rows,
    events: [...found.values()],
    freshness: typeof seconds === "number" ? Math.round(seconds * 1e3) : null
  };
}

// lib/monitor/server.ts
var session = null;
var reply = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
var fail = (msg, code) => reply({ error: msg }, code);
async function body(req) {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    throw Error("Send Content-Type application/json.");
  const reader = req.body?.getReader();
  if (!reader) throw Error("A JSON body is required.");
  let size = 0, raw = "";
  const dec = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 512e3) {
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
async function monitor(req, teacher) {
  if (!teacher) return fail("Open the dashboard on the teacher PC.", 403);
  if (req.method === "POST") {
    let cmd;
    try {
      cmd = await body(req);
    } catch (e) {
      return fail(e.message, 400);
    }
    if (!cmd || typeof cmd !== "object")
      return fail("Invalid exam command.", 400);
    if ((cmd.exam_id ?? null) !== (session?.id ?? null))
      return fail("The exam changed. Refresh and try again.", 409);
    if ((cmd.action === "prepare" || cmd.action === "start") && !session) {
      const now2 = Date.now();
      session = {
        id: crypto.randomUUID(),
        prepared: now2,
        // Accept a direct start from older dashboards as well.
        started: cmd.action === "start" ? now2 : null,
        freshness: 2e3,
        stations: /* @__PURE__ */ new Map(),
        events: /* @__PURE__ */ new Map()
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
  const stations = session ? [...session.stations.values()].sort(
    (a, b) => a.pc.localeCompare(b.pc, "en", { numeric: true })
  ) : [];
  const offset = Math.max(
    0,
    Math.floor(Number(url.searchParams.get("offset")) || 0)
  );
  const allEvents = session ? [...session.events.values()].sort(
    (a, b) => b.occurred - a.occurred || b.id.localeCompare(a.id)
  ) : [];
  return reply({
    exam: session ? {
      id: session.id,
      started: session.started,
      ended: null,
      freshness: session.freshness
    } : null,
    server_time: now,
    event_count: allEvents.length,
    events: allEvents.slice(offset, offset + 100),
    stations: stations.map((p) => {
      const connection = p.seen == null ? "Never connected" : p.stale || now - p.seen > (session?.freshness ?? 2e3) ? "Stale" : "Connected";
      return {
        ...p,
        connection,
        behavior: connection === "Connected" ? p.behavior : null
      };
    })
  });
}
async function ingest(req) {
  const id = new URL(req.url).searchParams.get("exam");
  if (!id) return fail("Use the active exam URL in Connection.", 400);
  if (session?.id !== id) return fail("This exam is closed or unknown.", 409);
  let data;
  try {
    data = normalize(await body(req), Date.now());
  } catch (e) {
    return fail(e.message, 422);
  }
  const active = session;
  if (!active || active.id !== id) return fail("This exam has ended.", 409);
  const now = Date.now();
  if (data.freshness != null) active.freshness = data.freshness;
  for (const r of data.rows) {
    if (r.seen != null && (r.seen < active.prepared || r.seen > now + 3e4))
      continue;
    const prev = active.stations.get(r.pc);
    if (prev?.seen != null && (r.seen == null || r.seen < prev.seen)) continue;
    const name = r.name ?? prev?.name ?? null;
    active.stations.set(r.pc, {
      ...r,
      name,
      section: r.section ?? prev?.section ?? null,
      checked: prev?.checked || Number(!!name && r.seen != null)
    });
  }
  for (const e of data.events) {
    if (e.occurred < active.prepared || e.occurred > now + 3e4 || active.events.has(e.id))
      continue;
    active.events.set(e.id, {
      ...e,
      names: e.pcs.map((pc) => active.stations.get(pc)?.name ?? null),
      before_exam: active.started === null || e.occurred < active.started
    });
  }
  return reply({ accepted: true, exam_id: id });
}
export {
  ingest,
  monitor
};
