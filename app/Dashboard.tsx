"use client";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Cpu,
  FileClock,
  Grid2X2,
  History,
  LayoutDashboard,
  Monitor,
  Network,
  Play,
  Plug,
  Radio,
  Search,
  Square,
  Table2,
  Timer,
  UserRound,
  UsersRound,
  Waypoints,
  X,
} from "lucide-react";
import { type EventKind } from "../lib/monitor/protocol";
type Exam = { id: string; started: number | null; ended: number | null };
type Station = {
  pc: string;
  name: string | null;
  section: string | null;
  seen: number | null;
  checked: number;
  connection: string;
  behavior: string | null;
};
type Logged = {
  id: string;
  kind: EventKind;
  occurred: number;
  pcs: string[];
  names: (string | null)[];
  before_exam?: boolean;
};
type Snapshot = {
  exam: Exam | null;
  stations: Station[];
  events: Logged[];
  event_count: number;
  server_time: number;
};
type Tab = "Monitor" | "Event log" | "Connection";
const empty: Snapshot = {
  exam: null,
  stations: [],
  events: [],
  event_count: 0,
  server_time: 0,
};
const fmtTime = (n: number) =>
  new Intl.DateTimeFormat("en-PH", {
    timeStyle: "medium",
    timeZone: "Asia/Manila",
  }).format(n);
const fmtDate = (n: number) =>
  new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
  }).format(n);
const tabs = [
  { name: "Monitor" as Tab, icon: LayoutDashboard },
  { name: "Event log" as Tab, icon: FileClock },
  { name: "Connection" as Tab, icon: Plug },
];
const sample = {
  freshness_timeout_seconds: 2,
  stations: {
    "PC-1": {
      Name: "Sample Student",
      section: "BSCP 1-2",
      status: "connected",
      received_at_utc: "<current UTC timestamp>",
      report: { behavior_status: "Normal" },
    },
  },
  events: [],
};
const eventSample = {
  event_id: "event-001",
  type: "reciprocal_gaze",
  stations: ["PC-1", "PC-2"],
  occurred_at_utc: "<UTC time when the event occurred>",
};
const tone = (s: string) => s.toLowerCase().replaceAll(" ", "-");
function Status({ s }: { s: string }) {
  return (
    <span className={"status " + tone(s)}>
      <i />
      {s}
    </span>
  );
}
function Mark() {
  return (
    <span className="mark">
      <img src="/favicon.svg" alt="" />
    </span>
  );
}
function EventList({
  items,
  full = false,
  sessionOpen,
  available,
}: {
  items: Logged[];
  full?: boolean;
  sessionOpen: boolean;
  available: boolean;
}) {
  return items.length ? (
    <div className="events">
      {items.map((e) => (
        <div className="eventRow" key={e.id}>
          <span
            className={
              "evtIcon " + (e.kind === "reciprocal_gaze" ? "paired" : "")
            }
          >
            {e.kind === "reciprocal_gaze" ? <Waypoints /> : <Activity />}
          </span>
          <div className="grow">
            <div className="eventName">
              <strong>
                {e.kind === "reciprocal_gaze"
                  ? "Two-station gaze event"
                  : "Individual gaze event"}
              </strong>
              {e.before_exam && <span className="eventPhase">Before exam</span>}
            </div>
            <small>
              {e.pcs
                .map((p, i) => (e.names[i] ? p + " · " + e.names[i] : p))
                .join(" / ")}
            </small>
          </div>
          <time>
            {full && fmtDate(e.occurred) + " · "}
            {fmtTime(e.occurred)}
          </time>
        </div>
      ))}
    </div>
  ) : (
    <div className="emptyEvents">
      <div className="emptyIcon">
        <Activity />
      </div>
      <strong>
        {!available
          ? "Waiting for the receiver"
          : sessionOpen
            ? "No events reported yet"
            : "No exam in progress"}
      </strong>
      <p>
        {!available
          ? "Events will appear when the receiver is connected."
          : sessionOpen
            ? "Events sent by student PCs will appear here."
            : "Prepare an exam to receive events from student PCs."}
      </p>
    </div>
  );
}
function CopyButton({ value }: { value: string }) {
  const [state, set] = useState("");
  return (
    <button
      className="secondary compact"
      disabled={!value}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          set("Copied");
        } catch {
          set("Select and copy the URL");
        }
        setTimeout(() => set(""), 2200);
      }}
    >
      {state === "Copied" ? <Check /> : <Copy />}
      <span aria-live="polite">{state || "Copy"}</span>
    </button>
  );
}
export default function Dashboard({ local = false }: { local?: boolean }) {
  const [tab, setTab] = useState<Tab>("Monitor"),
    [data, setData] = useState<Snapshot>(empty),
    [now, setNow] = useState(0),
    [receiver, setReceiver] = useState<string | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [confirmEnd, endDialog] = useState(false);
  const [grid, setGrid] = useState(false),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [refresh, tick] = useState(0);
  const lan = local;
  const [connecting, setConnecting] = useState(false),
    [lanAddress, setLanAddress] = useState("");
  const skew = useRef(0);
  const previousExam = useRef<string | null>(null);
  async function connect() {
    const base = local ? location.origin : "http://127.0.0.1:8766";
    setConnecting(true);
    try {
      const r = await fetch(base + "/deployment-info.json", {
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) throw Error();
      const info = (await r.json()) as {
        mode?: string;
        storage?: string;
        exam_preparation?: boolean;
        station_origin?: string;
        port?: number;
      };
      if (info.mode !== "lan" || info.storage !== "memory") throw Error();
      if (!info.exam_preparation) {
        setError("This receiver needs an update for exam preparation. Download the latest receiver and restart it on the teacher PC.");
        return null;
      }
      setLanAddress(
        info.station_origin || "http://<teacher-lab-IP>:" + (info.port || 8766),
      );
      setReceiver(base);
      setError("");
      return base;
    } catch {
      setError(
        "Couldn’t reach the receiver on this PC. Run node server.mjs in the extracted receiver folder, then try again.",
      );
      return null;
    } finally {
      setConnecting(false);
    }
  }
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now() + skew.current), 500);
    if (local) {
      void connect();
    }
    return () => clearInterval(timer);
  }, [local]);
  useEffect(() => {
    if (receiver === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function read() {
      const q = new URLSearchParams();
      if (tab === "Event log") {
        q.set("offset", String(offset));
      }
      try {
        const r = await fetch(receiver + "/api/monitor?" + q, {
          cache: "no-store",
          signal: controller.signal,
        });
        const v = (await r.json()) as Snapshot & { error?: string };
        if (!r.ok) throw Error(v.error || "Could not load the dashboard.");
        if (!cancelled) {
          if (previousExam.current !== (v.exam?.id ?? null)) {
            previousExam.current = v.exam?.id ?? null;
            setSearch("");
            setOffset(0);
            endDialog(false);
          }
          setData(v);
          skew.current = v.server_time - Date.now();
          setNow(v.server_time);
          setLoaded(true);
          setError("");
        }
      } catch (e) {
        if (!cancelled) {
          setData(empty);
          setLoaded(false);
          setSearch("");
          endDialog(false);
          setError(
            e instanceof Error && !/fetch|JSON|Unexpected/.test(e.message)
              ? e.message
              : "Receiver disconnected. Reconnecting…",
          );
        }
      }
      if (!cancelled) timer = setTimeout(read, 1000);
    }
    read();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [tab, receiver, offset, refresh]);
  useEffect(() => {
    if (!confirmEnd) return;
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape") endDialog(false);
    }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [confirmEnd]);
  function navigate(t: Tab) {
    setTab(t);
    setOffset(0);
    setNotice("");
    endDialog(false);
  }
  async function command(action: "prepare" | "start" | "end") {
    setBusy(true);
    setNotice("");
    try {
      const base = receiver ?? (action === "prepare" ? await connect() : null);
      if (!base) return;
      const endpoint = base + "/api/monitor";
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, exam_id: data.exam?.id ?? null }),
      });
      const v = (await r.json()) as { error?: string };
      if (action !== "end" && r.status === 409) {
        // Another tab may have prepared or started the session first.
        const current = await fetch(endpoint, { cache: "no-store" });
        if (current.ok) {
          const snapshot = (await current.json()) as Snapshot;
          if (snapshot.exam && snapshot.exam.ended === null) {
            setData(snapshot);
            setLoaded(true);
            setError("");
            setNotice(snapshot.exam.started === null
              ? "An exam is already being prepared. Showing its current status."
              : "An exam is already running. Showing its live updates.");
            tick((n) => n + 1);
            return;
          }
        }
      }
      if (!r.ok) throw Error(v.error || "Could not update exam.");
      if (action === "end") {
        setData(empty);
        setSearch("");
        setOffset(0);
      }
      setNotice(
        action === "prepare"
          ? "Exam prepared. Students can connect while the timer waits at zero."
          : action === "start"
            ? "Exam started. The timer is now running."
            : data.exam?.started === null
              ? "Preparation canceled. Student reports and events have been cleared."
              : "Exam ended. Student reports and events have been cleared.",
      );
      tick((n) => n + 1);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not update the exam.");
    } finally {
      setBusy(false);
      endDialog(false);
    }
  }
  const exam = data.exam;
  const sessionOpen = !!exam && exam.ended === null;
  const prepared = sessionOpen && exam.started === null;
  const active = sessionOpen && exam.started !== null;
  const available = receiver !== null && loaded && !error;
  const checkingReceiver = connecting || (receiver !== null && !loaded && !error);
  const receiverLabel = error
    ? "Receiver disconnected"
    : checkingReceiver
      ? "Checking receiver"
      : available
        ? "Receiver connected"
        : "Receiver not connected";
  const { stations, events, event_count: eventCount } = data;
  const hasReportedStations = stations.some((station) => station.seen !== null);
  const displayStations =
    error && !exam?.ended
      ? stations.map((p) => ({ ...p, connection: "Unknown", behavior: null }))
      : stations;
  const connected = displayStations.filter(
    (p) => p.connection === "Connected",
  ).length;
  const checked = stations.filter((p) => p.checked).length;
  const elapsed = exam?.started != null
    ? Math.max(0, Math.floor(((exam.ended ?? now) - exam.started) / 1000))
    : 0;
  const clock = [
    Math.floor(elapsed / 3600),
    Math.floor(elapsed / 60) % 60,
    elapsed % 60,
  ]
    .map((x) => String(x).padStart(2, "0"))
    .join(":");
  const rows = displayStations.filter((p) =>
    [p.pc, p.name, p.section].some((v) =>
      v?.toLowerCase().includes(search.toLowerCase()),
    ),
  );
  const url = sessionOpen ? lanAddress + "/api/reports?exam=" + exam.id : "";
  const desc =
    tab === "Monitor"
      ? "A clear view of your exam, student PCs, and recent activity."
      : tab === "Event log"
        ? "Review events reported during preparation and the exam. They are cleared when the session ends."
        : "Follow these steps to receive updates from student PCs.";
  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <Mark />
          <span>
            FairAware<small>Exam monitoring</small>
          </span>
        </div>
        <div className="navLabel">Workspace</div>
        <nav aria-label="Main navigation">
          {tabs.map(({ name, icon: Icon }) => (
            <button
              key={name}
              aria-current={tab === name ? "page" : undefined}
              className={tab === name ? "nav active" : "nav"}
              onClick={() => navigate(name)}
            >
              <Icon />
              {name}
            </button>
          ))}
        </nav>
        <div className="railFoot">
          <span className="profile">
            <UserRound />
          </span>
          <span>
            Teacher workspace
            <small className="receiverLabel">
              <i className={available ? "on" : ""} />
              {receiverLabel}
            </small>
          </span>
        </div>
      </aside>
      <div className="surface">
        <header className="top">
          <span className="crumb">
            Workspace <ChevronRight /> <b>{tab}</b>
          </span>
          <span className="date">
            <CalendarDays />
            {now ? fmtDate(now) : "—"}
          </span>
        </header>
        <main>
          <div className="heading">
            <div>
              <h1>{tab === "Monitor" ? "Exam overview" : tab}</h1>
              <p>{desc}</p>
            </div>
            {tab === "Monitor" && (
              <div className="headingActions">
                {prepared && (
                  <button className="secondary" disabled={busy || !available} onClick={() => endDialog(true)}>
                    Cancel preparation
                  </button>
                )}
                <button
                  className="primary"
                  disabled={busy || connecting || (receiver !== null && (!loaded || !!error))}
                  onClick={() => active ? endDialog(true) : void command(prepared ? "start" : "prepare")}
                >
                  {active ? <Square /> : prepared ? <Play /> : <Network />}
                  {busy
                    ? active ? "Ending exam…" : prepared ? "Starting exam…" : "Preparing exam…"
                    : active ? "End exam" : prepared ? "Start exam" : "Prepare exam"}
                </button>
              </div>
            )}
          </div>
          {receiver === null && tab === "Connection" && (
            <section className="card connection">
              <div className="sectionTitle">
                <span className="tileIcon">
                  <Network />
                </span>
                <h2>Connect the teacher PC</h2>
              </div>
              <p>
                Run <code>node server.mjs</code> from the extracted website on
                the teacher PC. The receiver keeps reports in memory for this
                exam.
              </p>
              <div className="receiverActions">
                <button
                  className="primary"
                  disabled={connecting}
                  onClick={() => void connect()}
                >
                  <Plug />
                  {connecting ? "Connecting…" : "Connect receiver"}
                </button>
                {!lan && (
                  <>
                    <a
                      className="secondary download"
                      href="/FairAware-Website.zip"
                      download
                    >
                      <ArrowDownToLine />
                      Download receiver
                    </a>
                    <a
                      className="secondary download"
                      href="http://localhost:8766/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open local dashboard
                    </a>
                  </>
                )}
              </div>
            </section>
          )}
          {error && (
            <div className="feedback warn" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="feedback" role="status">
              {notice}
              <button
                aria-label="Dismiss message"
                onClick={() => setNotice("")}
              >
                <X />
              </button>
            </div>
          )}
          {tab === "Monitor" && (
            <>
              <section className={"overviewBanner" + (active ? " isLive" : "")} aria-labelledby="overview-title">
                <div className="overviewCopy">
                  <div className="overviewMeta">
                    <span className="eyebrow">Current exam</span>
                    <span className={"examBadge" + (active ? " live" : prepared ? " preparing" : "")}>
                      <i />
                      {!available ? receiverLabel : active ? "Exam in progress" : prepared ? "Preparing · Timer not started" : "No exam prepared"}
                    </span>
                  </div>
                  <h2 id="overview-title">
                    {!available
                      ? error
                        ? "The receiver needs attention"
                        : checkingReceiver
                          ? "Connecting to the receiver"
                          : "Connect the teacher PC to begin"
                      : active
                        ? "Your exam is underway"
                        : prepared
                          ? "Connect students before starting"
                          : "Ready to prepare an exam?"}
                  </h2>
                  <p>
                    {!available
                      ? error
                        ? "Live updates are unavailable. Check that the receiver is running on this PC."
                        : checkingReceiver
                          ? "Checking the connection before loading your exam."
                          : "The receiver on this PC collects updates from your student PCs."
                      : active
                        ? hasReportedStations
                          ? "Keep an eye on your student PCs and review reported events below."
                          : "Your exam has started. Connect the student PCs to begin receiving updates."
                        : prepared
                          ? "Students can connect now. The timer stays at zero until you select Start exam."
                          : "Prepare a session to get the report link. Start the timer when your students are ready."}
                  </p>
                  <button className="overviewLink" onClick={() => navigate("Connection")}>
                    <Plug />
                    {!available ? "Open connection setup" : "How to connect student PCs"}
                  </button>
                </div>
                <div className="stepsPanel">
                  <span className="stepsTitle">A simple exam workflow</span>
                  <ol className="overviewSteps">
                    <li className={available && sessionOpen ? "complete" : available ? "current" : ""}>
                      <span>{sessionOpen && available ? <Check /> : "1"}</span>
                      <div><strong>Prepare the exam</strong><small>Create the report link</small></div>
                    </li>
                    <li className={available && sessionOpen && hasReportedStations ? "complete" : available && sessionOpen ? "current" : ""}>
                      <span>{available && sessionOpen && hasReportedStations ? <Check /> : "2"}</span>
                      <div><strong>Connect student PCs</strong><small>Use the report link and key</small></div>
                    </li>
                    <li className={available && active ? "complete" : available && prepared && hasReportedStations ? "current" : ""}>
                      <span>{available && active ? <Check /> : "3"}</span>
                      <div><strong>Start the exam</strong><small>The timer starts when you choose</small></div>
                    </li>
                  </ol>
                </div>
              </section>
              <div className="metrics">
                <div className="metric duration">
                  <div className="rings" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                    <em />
                  </div>
                  <div className="metricHead">
                    <Timer />
                    Exam duration
                  </div>
                  <strong className="timer">{available ? clock : "—"}</strong>
                  <span className="durationState">
                    <i className={active ? "on" : ""} />
                    {!available
                      ? receiverLabel
                      : active
                      ? "Exam in progress"
                      : prepared
                        ? "Waiting for you to start"
                        : "No active exam"}
                  </span>
                </div>
                <div className="metric">
                  <div className="metricHead">
                    <UsersRound />
                    Students checked in
                  </div>
                  <strong>{available ? checked : "—"}</strong>
                  <span className="metricNote">Students who have reported a name</span>
                </div>
                <div className="metric">
                  <div className="metricHead">
                    <Network />
                    Stations connected
                  </div>
                  <strong>
                    {available ? connected : "—"}
                    {available && stations.length > 0 && <em> / {stations.length}</em>}
                  </strong>
                  <span className="metricNote">
                    {available ? "Currently sending updates" : "Waiting for the receiver"}
                  </span>
                </div>
              </div>
              <section className="card">
                <div className="sectionHeader">
                  <div className="sectionTitle">
                    <span className="tileIcon">
                      <Monitor />
                    </span>
                    <div className="titleText">
                      <h2>Student stations</h2>
                      <p>See each PC’s connection and latest update.</p>
                    </div>
                  </div>
                  <div className="tools">
                    <label className="search">
                      <Search />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search name, PC, or section"
                        aria-label="Search by PC, name, or section"
                      />
                    </label>
                    <div className="switch">
                      <button
                        title="Table view"
                        aria-label="Table view"
                        aria-pressed={!grid}
                        onClick={() => setGrid(false)}
                      >
                        <Table2 />
                      </button>
                      <button
                        title="Grid view"
                        aria-label="Grid view"
                        aria-pressed={grid}
                        onClick={() => setGrid(true)}
                      >
                        <Grid2X2 />
                      </button>
                    </div>
                  </div>
                </div>
                {rows.length ? (
                  grid ? (
                    <div className="stationGrid">
                      {rows.map((p) => (
                        <div key={p.pc} className="station">
                          <div>
                            <b>
                              <Monitor />
                              {p.pc}
                            </b>
                            <Status s={p.connection} />
                          </div>
                          <strong>{p.name || "Awaiting student"}</strong>
                          <small>
                            {p.section || "Section pending"} ·{" "}
                            {p.behavior || "No current behavior"}
                          </small>
                          <small>
                            Last update · {p.seen ? fmtTime(p.seen) : "—"}
                          </small>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="tableWrap">
                      <table>
                        <thead>
                          <tr>
                            {[
                              "Station",
                              "Student name",
                              "Section",
                              "Connection",
                              "Behavior",
                              "Last update",
                            ].map((t) => (
                              <th key={t}>{t}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((p) => (
                            <tr key={p.pc}>
                              <td>
                                <b className="pc">
                                  <Monitor />
                                  {p.pc}
                                </b>
                              </td>
                              <td className={!p.name ? "muted" : ""}>
                                {p.name || "Awaiting student"}
                              </td>
                              <td>{p.section || "—"}</td>
                              <td>
                                <Status s={p.connection} />
                              </td>
                              <td>
                                {p.behavior ? (
                                  <Status s={p.behavior} />
                                ) : (
                                  <span className="muted">—</span>
                                )}
                              </td>
                              <td className="time">
                                {p.seen ? fmtTime(p.seen) : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : (
                  <div className="stationEmpty">
                    <span className="emptyIcon"><Monitor /></span>
                    <div>
                      <strong>
                        {stations.length
                          ? "No matching stations"
                          : !available
                            ? "Station updates are unavailable"
                            : sessionOpen
                              ? "Waiting for student PCs"
                              : "Your stations will appear here"}
                      </strong>
                      <p>
                        {stations.length
                          ? "Try a different name, PC, or section."
                          : !available
                            ? "Connect the receiver to see station updates."
                            : sessionOpen
                              ? "Connect your student monitoring program to this exam to see its PCs here."
                              : "Prepare an exam, then connect your student PCs to see live updates."}
                      </p>
                      {!stations.length && available && sessionOpen && (
                        <button className="inlineAction" onClick={() => navigate("Connection")}>
                          Set up student PCs
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {available && sessionOpen && (
                  <details className="statusHelp">
                    <summary>What do the connection statuses mean?</summary>
                    <p><strong>Connected:</strong> the PC sent a recent update. <strong>Stale:</strong> its update is late or was marked stale. <strong>Never connected:</strong> it has not sent an update yet.</p>
                  </details>
                )}
              </section>
              <section className="card">
                <div className="sectionHeader">
                  <div className="sectionTitle">
                    <span className="tileIcon">
                      <Activity />
                    </span>
                    <div className="titleText">
                      <h2>Recent events</h2>
                      <p>Activity reported during preparation and the exam.</p>
                    </div>
                  </div>
                  <button
                    className="textBtn"
                    onClick={() => navigate("Event log")}
                  >
                    View event log
                  </button>
                </div>
                <EventList items={events.slice(0, 5)} sessionOpen={sessionOpen} available={available} />
              </section>
            </>
          )}
          {tab === "Event log" && (
            <section className="card">
              <div className="sectionHeader">
                <div className="sectionTitle">
                  <span className="tileIcon">
                    <History />
                  </span>
                  <h2>
                    Session events{" "}
                    <span className="count">{available ? eventCount : "—"}</span>
                  </h2>
                </div>
              </div>
              <EventList items={events} full sessionOpen={sessionOpen} available={available} />
              {eventCount > 100 && (
                <div className="pagination">
                  <button
                    disabled={!offset}
                    onClick={() => setOffset(Math.max(0, offset - 100))}
                  >
                    <ChevronLeft />
                    Previous
                  </button>
                  <span>
                    {offset + 1}–{Math.min(offset + 100, eventCount)}
                  </span>
                  <button
                    disabled={offset + 100 >= eventCount}
                    onClick={() => setOffset(offset + 100)}
                  >
                    Next
                    <ChevronRight />
                  </button>
                </div>
              )}
            </section>
          )}
          {tab === "Connection" && (
            <>
              <section className="card connection setupCard">
                <div className="connectionHeading">
                  <div className="sectionTitle">
                    <span className="tileIcon"><Plug /></span>
                    <div className="titleText">
                      <h2>Connect student PCs</h2>
                      <p>Set up your existing student monitoring program for this exam.</p>
                    </div>
                  </div>
                  <span className={"examBadge" + (active ? " live" : prepared ? " preparing" : "")}>
                    <i />{!available ? receiverLabel : active ? "Exam in progress" : prepared ? "Preparing · Timer not started" : "Prepare an exam first"}
                  </span>
                </div>
                <ol className="setupSteps">
                  <li><span>1</span><div><strong>Prepare an exam</strong><p>Create a report link without starting the timer.</p></div></li>
                  <li><span>2</span><div><strong>Copy the report URL</strong><p>Add the URL below to your student monitoring program.</p></div></li>
                  <li><span>3</span><div><strong>Add the report key</strong><p>Find the key in <code>data/report-key.txt</code> on the teacher PC.</p></div></li>
                </ol>
                <div className="reportPanel">
                  <div className="reportLabel">
                    <strong>Report URL</strong>
                    <span>A new URL is created for each exam.</span>
                  </div>
                  <div className="urlbox">
                    <span>POST</span>
                    <code>{url || (available ? "Prepare an exam to create its report URL." : "Connect the teacher PC first.")}</code>
                    <CopyButton value={url} />
                  </div>
                  {!active && available && (
                    <button className="inlineAction" onClick={() => navigate("Monitor")}>
                      Go to exam overview
                    </button>
                  )}
                  {prepared && <p className="setupHint">Students can connect now. Return to the overview and select Start exam when you are ready.</p>}
                  {sessionOpen && lanAddress.includes("<") && (
                    <p className="setupWarning">Replace &lt;teacher-lab-IP&gt; in the URL with the teacher PC’s network address before using it.</p>
                  )}
                </div>
              </section>
              <section className="card connection">
                <div className="sectionTitle">
                  <span className="tileIcon">
                    <Cpu />
                  </span>
                  <div className="titleText">
                    <h2>Technical setup</h2>
                    <p>Share these details with whoever manages the monitoring program.</p>
                  </div>
                </div>
                <details>
                  <summary>Request headers and timing</summary>
                  <dl>
                    <dt>Content type</dt><dd><code>application/json</code></dd>
                    <dt>Authentication</dt>
                    <dd><code>Authorization: Bearer &lt;report-key&gt;</code><small>Use the key from data/report-key.txt on the teacher PC.</small></dd>
                    <dt>Freshness</dt><dd>2 seconds by default. A late station shows as stale.</dd>
                  </dl>
                </details>
                <details>
                  <summary>Station report example</summary>
                  <p>
                    Include the station ID, student name and section. Send a new UTC timestamp with each fresh observation. Behavior accepts Normal, Alert, or Suspicious behavior.
                  </p>
                  <pre>{JSON.stringify(sample, null, 2)}</pre>
                </details>
                <details>
                  <summary>Event example</summary>
                  <p>
                    Add this object to the snapshot’s events array. Use
                    individual_lateral_gaze with one station or reciprocal_gaze
                    with two. Reuse the same event ID when retrying.
                  </p>
                  <pre>{JSON.stringify(eventSample, null, 2)}</pre>
                  <p className="footnote">
                    Your coordinator can also send individual_lateral_gaze and
                    reciprocal_gaze.pairs in its existing snapshot. An idle pair
                    produces no event.
                  </p>
                </details>
              </section>
              {!lan && receiver !== null && (
                <section className="card connection">
                  <div className="sectionTitle">
                    <span className="tileIcon">
                      <Network />
                    </span>
                    <h2>Run on the laboratory network</h2>
                  </div>
                  <p>
                    Host this website on the teacher’s Windows PC to receive
                    reports over the LAN. The download includes the teacher
                    website and start instructions.
                  </p>
                  <a
                    className="secondary download"
                    href="/FairAware-Website.zip"
                    download
                  >
                    <ArrowDownToLine />
                    Download website
                  </a>
                </section>
              )}
            </>
          )}
          <footer>
            <span>
              <Radio /> Session data clears when the exam ends or preparation is canceled
            </span>
            <span>Times shown in Philippine time</span>
          </footer>
        </main>
      </div>
      {confirmEnd && (
        <dialog
          open
          className="modal"
          aria-modal="true"
          aria-labelledby="endTitle"
          aria-describedby="endDescription"
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              const b = e.currentTarget.querySelectorAll("button");
              if (b.length === 2) {
                e.preventDefault();
                (document.activeElement === b[0] ? b[1] : b[0]).focus();
              }
            }
          }}
        >
          <h2 id="endTitle">{prepared ? "Cancel exam preparation?" : "End this exam?"}</h2>
          <p id="endDescription">
            Student names, sections, station reports, and events will be cleared
            from memory. The exam’s report URL will close.
          </p>
          <div>
            <button
              autoFocus
              className="secondary"
              onClick={() => endDialog(false)}
            >
              {prepared ? "Keep preparing" : "Keep monitoring"}
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => command("end")}
            >
              {prepared ? "Cancel preparation" : "End exam"}
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}
