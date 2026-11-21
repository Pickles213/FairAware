import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["lib/monitor/server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { monitor, ingest } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`
);

const request = (path, body) => new Request(`http://localhost${path}`, body === undefined
  ? undefined
  : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const snapshot = async () => (await monitor(request("/api/monitor"), true)).json();
const command = (action, examId = null) => monitor(request("/api/monitor", { action, exam_id: examId }), true);

test("preparation keeps the timer stopped and preserves reports when the exam starts", async () => {
  const originalNow = Date.now;
  let now = Date.parse("2026-01-01T08:00:00.000Z");
  Date.now = () => now;
  try {
    assert.equal((await command("prepare")).status, 201);
    const prepared = await snapshot();
    const id = prepared.exam.id;
    assert.equal(prepared.exam.started, null);

    now += 10 * 60 * 1000;
    const report = {
      freshness_timeout_seconds: 120,
      stations: { "PC-1": { Name: "Test Student", received_at_utc: new Date(now).toISOString(), report: { behavior_status: "Normal" } } },
      events: [{ event_id: "before", type: "individual_lateral_gaze", stations: ["PC-1"], occurred_at_utc: new Date(now).toISOString() }],
    };
    assert.equal((await ingest(request(`/api/reports?exam=${id}`, report))).status, 200);
    const waiting = await snapshot();
    assert.equal(waiting.exam.started, null);
    assert.equal(waiting.stations[0].name, "Test Student");
    assert.equal(waiting.event_count, 1);
    assert.equal(waiting.events[0].before_exam, true);

    now += 60 * 1000;
    assert.equal((await command("start", id)).status, 200);
    const started = await snapshot();
    assert.equal(started.exam.id, id);
    assert.equal(started.exam.started, now);
    assert.equal(started.stations[0].name, "Test Student");
    assert.equal(started.events[0].before_exam, true);

    now += 30 * 1000;
    report.stations["PC-1"].received_at_utc = new Date(now).toISOString();
    report.events.push({ event_id: "during", type: "individual_lateral_gaze", stations: ["PC-1"], occurred_at_utc: new Date(now).toISOString() });
    assert.equal((await ingest(request(`/api/reports?exam=${id}`, report))).status, 200);
    const running = await snapshot();
    assert.equal(running.event_count, 2);
    assert.equal(running.events.find((event) => event.id === "during").before_exam, false);
    assert.equal(running.events.find((event) => event.id === "before").before_exam, true);
    assert.equal((await command("start", id)).status, 409);
    assert.equal((await snapshot()).exam.started, started.exam.started);

    assert.equal((await command("end", id)).status, 200);
    const ended = await snapshot();
    assert.equal(ended.exam, null);
    assert.equal(ended.stations.length, 0);
    assert.equal(ended.event_count, 0);
    assert.equal((await ingest(request(`/api/reports?exam=${id}`, report))).status, 409);

    assert.equal((await command("prepare")).status, 201);
    const canceledId = (await snapshot()).exam.id;
    assert.equal((await command("end", canceledId)).status, 200);
    assert.equal((await snapshot()).exam, null);

    // Existing integrations that issue a direct start still start immediately.
    assert.equal((await command("start")).status, 201);
    const legacy = await snapshot();
    assert.equal(legacy.exam.started, now);
    assert.equal((await command("end", legacy.exam.id)).status, 200);
  } finally {
    Date.now = originalNow;
  }
});
