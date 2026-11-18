# LoopLess

LoopLess turns a list of errands into an inspectable route and schedule. It keeps every task, protects completion deadlines, and shows exactly where travel, waiting, and service time go.

Built as a Technical Track productivity prototype for a hackathon. The original project commit, 13749f9, was created on November 17, 2026. This revamp uses the same solver problem and the same fixed benchmark corpus, with a new route studio and separate fictional Houston / Riverside examples.

## Route studio

- Warm daylight and dark palettes, local system fonts, visible keyboard focus, and text palette contrast of at least 4.5 to 1.
- A 2D mile-grid overlay with dashed FIFO and solid LoopLess routes. The verdict immediately shows travel minutes saved, rescued deadlines, and the earlier finish.
- Play, Pause, Step, restart, and a replay scrubber. One schedule clock drives both the commuter marker and every Gantt playhead, including waiting, service, and the return trip.
- Click empty map space to add an errand. Select a numbered pin to inspect or edit its name, coordinates, opening window, service duration, priority, and prerequisite.
- Transactional validation, cycle rejection, safe deletion, and 40-step undo / redo. Deleting a prerequisite requires removing the dependent constraint first.
- Four illustrative presets covering after-school STEM errands, Saturday family groceries and library tasks, hackathon hardware supplies, and intentional overload.
- A live four-mode comparison and an independently re-optimized 16-point delay curve from +0 through +15 minutes per moving leg.
- Strictly validated share hashes, browser persistence, RFC 5545 calendar export, JSON export, and a one-page daily card with a modal preview.
- A local Web Worker with a labeled main-thread fallback, stale-response protection, and no dependencies or external requests.
- A secret inline SVG capybara with a tangerine and tiny backpack. Click the buddy or open #capybara-buddy. It reacts to a better tour or zero missed deadlines, and respects reduced motion.

## Run locally

No package installation is needed. Use Node 18 or newer for tests and evaluation.

~~~sh
python3 -m http.server 18932 --bind 127.0.0.1
~~~

Open http://localhost:18932 in a browser. The app can run without internet access while its local server is available. ES modules require HTTP serving.

~~~sh
npm test
npm run eval:check
npm run eval:json
~~~

## Verified results

The deterministic Node suite has **149 passing tests, zero failures**. Tests cover independent brute-force optimality, all fixed benchmark scenarios, editor validation, cycles, undo / redo, hostile hashes, prototype pollution, XSS rejection, persistence failures, transit comparisons, exact delay tipping points, map projection, co-located pins, route replay, RFC 5545 edge cases, DOM contracts, local requests, both contrast palettes, demo contracts, and source hygiene.

**Zero objective gap on 45 small tours with N <= 7**, using an independent brute-force oracle that recomputes travel, waiting, service, deadlines, and slack. These include 13 small fixed benchmark cases, all four new studio presets, and 28 reproducible seeded cases. The seeded cases mix modes, metrics, prerequisites, jitter, no-return trips, co-location, and tight windows.

### Default after-school example

These are model outputs for the fictional bicycle preset, with zero added delay.

| Metric | Listed order / FIFO | LoopLess |
| --- | --- | --- |
| Travel | 134 min | 78 min |
| Day span | 244 min | 145 min |
| Missed completion deadlines | 3 | 0 |
| Return time | 19:34 | 17:55 |

That is **56 travel minutes saved**, **99 minutes earlier overall**, and **three rescued deadlines**. The independently re-optimized delay sweep remains feasible at +12 minutes per moving leg, with one minute of minimum margin. Its first failure is at **+13 minutes**, when the STEM kit finishes two minutes late.

### Fixed 16-scenario benchmark

The original corpus remains unchanged, so these metrics are directly comparable with version 1.

| Strategy | Feasible days | Total travel |
| --- | --- | --- |
| LoopLess | 15 / 16 | 1,611 min |
| FIFO | 10 / 16 | 2,242 min |
| Earliest Deadline First | 15 / 16 | 2,120 min |
| Nearest Neighbor | 8 / 16 | 1,629 min |

- **631 travel minutes saved vs FIFO, a 28.1% reduction.**
- **3,083 min total day span vs 3,850 min FIFO, saving 767 min or 19.9%.**
- Strictly beats FIFO on **14 / 16** cases and beats or ties all three baseline strategies on **16 / 16**.
- **15 exact searches, zero bounded searches, one 14-stop heuristic case.**
- The intentional overload remains infeasible and is reported honestly.

The in-app benchmark recomputes the same corpus and shows comparative travel bars and per-scenario results. [Raw benchmark report](evidence/benchmark.json) and [verification notes](evidence/verification.md) provide the recorded evidence.

## Solver and guarantees

The objective is lexicographic, in this order.

1. Satisfy prerequisites.
2. Minimize missed completion deadlines.
3. Minimize total lateness.
4. Minimize total day span, including waits and an optional return.
5. Minimize travel minutes.
6. Maximize the minimum deadline margin.

Priority breaks EDF seed ties. It does not permit dropping tasks, override prerequisites, or change the exact objective.

For up to 12 stops, Branch-and-Bound seeds its incumbent with prerequisite-respecting FIFO, EDF, and nearest-neighbor tours. It uses admissible outgoing-travel and remaining-service lower bounds, monotone missed-deadline and lateness costs, and a slack upper bound. Open tours account for the missing final outgoing edge. A completed search is exact.

The default safety budget is **1,500,000 search nodes**. Exhaustion returns a visibly labeled bounded result after deterministic 2-opt polishing. Tests deliberately exhaust a one-node budget and verify that this result never claims exactness and still beats or ties the seeds. The core solver supports larger tours with deterministic 2-opt; the interactive studio is capped at 12. No unconditional exactness claim is made for a budget-limited result.

## Synthetic model and guardrails

All presets are fictional examples inspired by Houston / Riverside errands. They contain no real addresses, personal schedules, school identifiers, GPS coordinates, or field-trial claims.

| Mode | Constant speed | Overhead per moving leg |
| --- | --- | --- |
| Walk | 3.1 mph | 1 min |
| Bike | 11.5 mph | 2 min |
| Bus / Rail | 14 mph | 6 min |
| Carpool | 22 mph | 4 min |

For a nonzero-distance leg, travel is the rounded distance / speed estimate plus its mode overhead, followed by the selected integer delay. A zero-distance leg costs zero travel and receives no added delay. The street-grid metric uses Manhattan distance; the direct metric uses Euclidean distance.

Closing times are **completion deadlines**, with completion exactly at closing accepted. Service is not preempted. Windows use same-day 24-hour clock inputs and do not span midnight; a late completion or return can roll into the next day.

There is no road-network routing, live GPS, congestion model, actual bus or rail timetable, probabilistic delay model, or field validation. The constant-speed transit comparison is illustrative and does not establish that a transit line exists. A delay tipping point is exact within the chosen model and whole-minute sweep only when all relevant searches complete. Bounded sweep results are explicitly labeled best-found.

Nearby pins can move slightly for readable hit targets, with leader lines to their exact input coordinates. Route geometry and the replay marker retain the actual model coordinates.

## Sharing, persistence, and exports

- Versioned #tour= hashes use UTF-8 and base64url, with strict allowlists at envelope, tour, anchor, and stop levels.
- Inputs are bounded to 12 stops, coordinates from -10 to +10 miles, names of at most 80 characters, 10,000 decoded JSON bytes, and a 16,000-character hash.
- Prototype keys, unexpected fields, markup, control characters, malformed encodings, invalid times, and cyclic or missing prerequisites are rejected. Input objects are never merged into global prototypes.
- Dynamic UI content uses textContent and created DOM / SVG nodes. Production modules have no HTML parsing or dynamic-code sinks.
- The app stores only its own day and theme keys. Blocked storage or quota failure leaves a working in-memory planner. A shared URL contains the errand data, so share deliberately.
- Calendar files use local floating times, CRLF boundaries, 75-octet UTF-8 folding, date-qualified encoded UIDs, escaped text, valid calendar dates, and midnight rollover.
- JSON contains the exact inputs, selected search method, schedule, baselines, model scope, and every delay point.
- The daily card includes the full stop order, work and finish times, closing deadlines, minimum margins, return information, and model scope. Long names are shortened visually on the card, with full text in hover titles, calendar files, and JSON. Print CSS renders a single Letter page for the studio's 12-stop cap.

## Demo kit

[321-word narration](video/narration.txt) and [138-second recorder steps](video/steps.json) cover the FIFO overlay, route replay, editing, undo, mode changes, the +12 / +13 minute boundary, honest overload, benchmark, calendar and JSON downloads, daily-card preview, sharing, and the capybara.

The steps use the existing make-video recorder schema. From this repository, a recording can be made with the station's script.

~~~sh
node ../../make-video.mjs --url http://127.0.0.1:18932/ --steps video/steps.json --out video/demo.mp4
~~~

The narration is intended for about 2 minutes 18 seconds at 140 words per minute. Recording assets are source files; the repository does not claim a produced or uploaded video.

## Source map

| File | Responsibility |
| --- | --- |
| js/planner.mjs | Pure solver, schedule evaluator, and calendar exporter |
| js/studio.mjs | Validation, transactional edits, history, safe sharing, persistence, mode matrix, and delay analysis |
| js/map.mjs | Mile-grid projection, nearby-pin layout, route vertices, replay position, and replay steps |
| js/solver-worker.mjs | Local worker analysis with typed request IDs |
| js/presets.mjs | Four new fictional studio examples |
| js/scenarios.mjs | Original fixed benchmark corpus |
| js/benchmark.mjs | Reproducible browser and CLI evaluation |
| js/app.js | Safe DOM rendering and studio interactions |
| tests/ | Deterministic algorithm, model, security, export, accessibility, and demo checks |

MIT licensed.
