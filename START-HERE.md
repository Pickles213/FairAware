# FairAware source code

## Run on the teacher PC

1. Install Node.js 24. Extract this source archive and open the FairAware folder.
2. Open PowerShell in this folder and run these two commands.

```powershell
Expand-Archive .\public\FairAware-Website.zip -DestinationPath .\run
node .\run\server.mjs
```

3. Open http://localhost:8766 in the teacher PC's browser. Keep PowerShell open during the exam.
4. Select **Prepare exam** on the Monitor page. This creates a new session and report URL, but the exam timer stays at zero.
5. Open **Connection** to copy the report URL. On the student PCs or lab coordinator, configure your existing monitoring program to send JSON to this URL. Use the teacher PC's LAN address and the receiver key from `run/data/report-key.txt`. See `lan/START-HERE.txt` for the HTTP headers and setup details.
6. Once students are ready, return to **Monitor** and select **Start exam**. The timer begins then, and the same report URL remains valid. Reports received during preparation stay visible; events from that period are marked **Before exam**.

The student batch file launches your existing detection program. The dashboard displays its reports. Video stays on the student PC. The receiver keeps exam data in memory and clears it when the exam ends or the receiver stops.

## Where to edit

| File | Purpose |
| --- | --- |
| app/Dashboard.tsx | Teacher dashboard, exam controls, station list, and event history |
| app/globals.css | Dashboard styles |
| lib/monitor/protocol.ts | JSON report validation and interpretation |
| lib/monitor/server.ts | Exam lifecycle, in-memory stations, and event handling |
| lan/server.mjs | Teacher PC HTTP receiver and local web server |
| lan/entry.tsx | Entry point for the local dashboard |
| lan/package.mjs | Builds the dashboard and packages the receiver for the lab |
| public/FairAware-Website.zip | Ready-to-run website and receiver |

## Rebuild after editing

With Node.js 24, npm, and a working `python3` command, open a terminal in the FairAware folder and run the following commands. The build script uses Python to create the ZIP.

```sh
npm run install:ci
node lan/package.mjs
node outputs/lan/server.mjs
```

The build updates `public/FairAware-Website.zip`. The last command starts the rebuilt website on the teacher PC. Run only one receiver on its default port at a time.
