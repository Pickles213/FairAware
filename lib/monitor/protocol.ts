export const behaviors = ["Normal", "Alert", "Suspicious behavior"] as const;
export type Behavior = (typeof behaviors)[number];
export type EventKind = "individual_lateral_gaze" | "reciprocal_gaze";
export const labels: Record<EventKind, string> = {
  individual_lateral_gaze: "Individual lateral-gaze",
  reciprocal_gaze: "Reciprocal-gaze",
};
type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v);
const tag = (v: unknown) =>
  typeof v === "string" ? v.trim().toLowerCase().replace(/[ -]+/g, "_") : "";
function limited(v: unknown, max: number): string | null {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || v.length > max)
    throw Error("A text field exceeds its limit or has the wrong type.");
  return v.trim() || null;
}
function pcId(v: unknown): string {
  const s = limited(v, 48);
  if (!s || !/^[a-z0-9][a-z0-9 _.-]*$/i.test(s))
    throw Error("Each station needs a valid PC identifier.");
  return s;
}
function stamp(v: unknown): number {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    throw Error("Use an ISO timestamp with a timezone.");
  return Date.parse(v);
}
export function normalize(payload: unknown, now: number) {
  if (!object(payload) || !object(payload.stations))
    throw Error("Supply a JSON object containing a stations map.");
  const entries = Object.entries(payload.stations);
  if (entries.length > 200)
    throw Error("Send at most 200 stations per request.");
  const seconds = payload.freshness_timeout_seconds;
  if (
    seconds != null &&
    (typeof seconds !== "number" ||
      !Number.isFinite(seconds) ||
      seconds <= 0 ||
      seconds > 600)
  )
    throw Error("Invalid freshness timeout.");
  const rows = entries.map(([key, v]) => {
    const pc = pcId(key);
    if (!object(v)) throw Error("Invalid station object.");
    if (v.report != null && !object(v.report))
      throw Error("A station report must be an object or null.");
    const r = object(v.report) ? v.report : null;
    const name = limited(v.Name ?? v.name ?? r?.name, 100),
      section = limited(v.section ?? v.Section ?? r?.section, 80);
    const idle = tag(v.status) === "never_connected";
    const value =
      r?.behavior_status ?? r?.behavior ?? r?.status ?? v.behavior_status;
    const behavior = behaviors.find((b) => tag(b) === tag(value)) ?? null;
    const seen = idle
      ? null
      : v.received_at_utc != null
        ? stamp(v.received_at_utc)
        : r
          ? now
          : null;
    return {
      pc,
      name,
      section,
      seen,
      behavior: seen == null ? null : behavior,
      stale: Number(v.stale === true || tag(v.status) === "stale"),
      checked: Number(!!name && seen != null),
    };
  });
  const found = new Map<
    string,
    { id: string; kind: EventKind; pcs: string[]; occurred: number }
  >();
  function add(v: unknown, kindValue: unknown, stationsValue: unknown) {
    if (!object(v)) throw Error("Each event must be an object.");
    const k = tag(v.type ?? v.kind ?? v.event_type ?? kindValue);
    if (k !== "individual_lateral_gaze" && k !== "reciprocal_gaze")
      throw Error("Unknown event type.");
    const raw = v.stations ?? v.station ?? v.station_id ?? stationsValue;
    const pcs = (Array.isArray(raw) ? raw : [raw]).map(pcId).sort();
    if (
      new Set(pcs).size !== pcs.length ||
      pcs.length !== (k === "reciprocal_gaze" ? 2 : 1)
    )
      throw Error("The event has an invalid station count.");
    const occurred = stamp(
      v.occurred_at_utc ??
        v.first_observed_at_utc ??
        v.started_at_utc ??
        v.timestamp_utc,
    );
    const id =
      limited(v.event_id ?? v.id, 160) ?? JSON.stringify([k, pcs, occurred]);
    found.set(id, { id, kind: k, pcs, occurred });
  }
  if (payload.events != null && !Array.isArray(payload.events))
    throw Error("events must be an array.");
  for (const v of (payload.events ?? []) as unknown[])
    add(v, undefined, undefined);
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
    freshness: typeof seconds === "number" ? Math.round(seconds * 1000) : null,
  };
}
