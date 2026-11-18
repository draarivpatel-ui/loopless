# LoopLess

**Time-windowed daily route, errand, and task tour optimizer for students and families.**

LoopLess replaces back-and-forth daily errands and missed closing-hour deadlines with an exact, inspectable tour solver that balances travel time, opening/closing windows, prerequisite chains, and schedule slack across walking, biking, bus/rail, and carpool trips.

## Key Capabilities

- **Exact Time-Windowed Tour Solver (`js/planner.mjs`):** Runs exact Branch-and-Bound with deadline, outgoing-travel (`minOut`), span, and slack lower-bound pruning for up to 12 stops (0 optimality gap verified against brute-force permutation search for N <= 7) and deterministic 2-opt local search for 13+ stops (with a safety node budget fallback to 2-opt on degenerate tie storms).
- **Side-by-Side Baseline Comparison:** Compares LoopLess against Listed Order (FIFO), Earliest Deadline First (EDF), and Nearest Neighbor Greedy on on-time completion, travel minutes, idle wait, clock span, and minimum deadline slack.
- **Prerequisite Constraints & Delay Buffer:** Supports hard step dependencies (e.g., library return before tutoring, supply pickup before check-in) and a `+0` to `+15 min` transit jitter slider to test buffer resilience.
- **Visual Route Geometry & Gantt Timeline:** Plots baseline vs optimized routes on an interactive 2D mile grid alongside per-stop travel, wait, work, and slack bars.
- **Calendar & Data Exports:** Generates valid RFC-5545 `.ics` calendar files, JSON route plans, and a print-formatted daily card (`@media print`).
- **Offline & Zero Dependencies:** Plain HTML, CSS, and ES modules with `connect-src 'none'` CSP and zero external fonts, packages, or API calls.

## Model Scope & Guardrails

- Coordinates, transit mode speeds (`walk` 3.1 mph, `bike` 11.5 mph, `bus` 14.0 mph, `car` 22.0 mph), stop overheads, and service durations are explicit synthetic/user-entered model inputs, not live GPS or real-time traffic feeds.
- Exact optimality is guaranteed for up to 12 stops; larger tours use deterministic 2-opt search.
- Intentional overload scenarios report missed deadlines and lateness honestly rather than hiding conflicts.

## Verification & Benchmark

Run with Node 18+ (verified on Node v24+):

```sh
npm test
npm run eval:check
npm run eval:json
```

Across the 16-scenario synthetic benchmark corpus:
- Feasibility: **15/16** scenarios completed on time (vs **10/16** FIFO, **15/16** EDF, **8/16** Nearest Neighbor; scenario 14 is an intentional overload probe).
- Total travel time: **1,611 min** vs **2,242 min** FIFO (**631 min saved, -28.1%**).
- Total clock span: **3,083 min** vs **3,850 min** FIFO (**767 min saved, -19.9%**).
- Beats or ties every baseline heuristic on **16/16** scenarios.
