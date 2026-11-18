# LoopLess verification

Verified on November 18, 2026, using the local HTTP server and T3 Code Preview. This is implementation verification. Cross-review is planned before pushing.

## Deterministic checks

- 149 Node tests pass, with zero failures.
- The independent brute-force oracle agrees on all 45 small tours with N <= 7.
- All 16 fixed benchmark scenarios pass eval:check.
- The original corpus is unchanged.
- 15 exact searches, zero bounded searches, and one 14-stop heuristic case.
- Zero typographic em or en dashes, smart quotes, personal email domains, or home-directory paths in shipped text and SVG files.
- Production modules use created DOM nodes and textContent, with no HTML parsing or dynamic-code sinks.
- Both text palettes meet 4.5 to 1 contrast for the tested foreground / background pairs.

## Fixed benchmark

| Result | Verified value |
| --- | --- |
| LoopLess total travel | 1,611 min |
| FIFO total travel | 2,242 min |
| Travel saved | 631 min / 28.1% |
| LoopLess total day span | 3,083 min |
| FIFO total day span | 3,850 min |
| Day span saved | 767 min / 19.9% |
| Feasible days | LoopLess 15, FIFO 10, EDF 15, nearest 8, out of 16 |
| Beats or ties all baselines | 16 / 16 |
| Strictly beats FIFO | 14 / 16 |

## Live Preview browser

| CSS viewport | Document scroll width | External requests | Application errors |
| --- | --- | --- | --- |
| 1440 x 900 | 1440 px | 0 | 0 |
| 390 x 844 | 390 px | 0 | 0 |
| 1920 x 1080 | 1920 px | 0 | 0 |

Application error checks include console diagnostics, page errors, and unhandled rejections during the interaction runs. Asset requests remain on the local origin. Versioned local asset URLs prevent mixing earlier cached files with the new studio.

The following interactions were performed in T3 Preview.

- Blank-grid addition, pin inspection, name / coordinate / duration / priority / prerequisite editing, saving, deletion, undo, and redo.
- A deliberately injected dependency cycle was rejected, with the last valid tour preserved.
- Play, Pause, Step, restart, and scrubbing. The marker and Gantt playhead clocks matched exactly.
- Live mode selection. Carpool shows 56 min travel on the default tour; Bike shows 78 min.
- The default delay boundary. At +12, every errand finishes on time and minimum slack is 1 min. At +13, one deadline is missed and minimum slack is -2 min.
- Share creation, URL restoration, hostile markup rejection, and prototype-key rejection. No injected SVG executed and no prototype changed.
- Capybara click reaction, a visible secret message, and the inline SVG buddy.
- Theme toggling, calendar and JSON downloads, and the daily-card dialog.
- Deliberate Worker constructor failure. The UI reported Main thread fallback and retained the correct 56-minute payoff. A fresh navigation restored Web Worker mode.

Mobile day settings collapse initially to prioritize the verdict and map. The inspector, mode cards, replay, jitter, share dialog, and daily card fit the mobile viewport without horizontal scrolling.

## Calendar and print

Actual browser downloads were generated for the default four-stop tour. Calendar output was 1,201 bytes and JSON output was 16,426 bytes during the export check. The JSON includes the inputs, exact schedule, baselines, and all delay points. Unit tests cover calendar dates, rollover, line injection, text escaping, UTF-8 folding, and CRLF output.

The daily-card preview was opened in the browser. Its print button invoked the native print handler in an instrumented check. Print layout was measured using the app's own print CSS at a 720 px content width, corresponding to a Letter page with half-inch margins.

A 12-stop tour with 80-character names measured **680.078125 px high**, below the **960 px** available content height. Long names are clipped visually and retain their full text in title attributes and exports.

## Demo source verification

- Narration has 321 words.
- The recorder timeline ends at 138 seconds.
- All 19 click targets were checked with elementFromPoint and clicked using real coordinates at 1920 x 1080.
- The scene sequence includes the FIFO overlay, replay, editing and undo, mode changes, the +12 / +13 delay boundary, honest overload, the benchmark, calendar and JSON downloads, daily-card preview, sharing, and the capybara.
- Time marks were skipped during the coordinate verification pass. The timing schema and ordered time marks are separately checked by the Node suite.
- Recording and narration source files are provided. No generated or uploaded MP4 is claimed.

## Scope

These are fictional errands, synthetic mile coordinates, constant speeds, fixed overheads, and deterministic delays. There are no live GPS, road-network, traffic, actual transit timetable, or field-trial claims. Exactness requires a completed Branch-and-Bound search. Budget exhaustion and heuristic results are labeled.

The owned Preview tab and temporary HTTP server are closed after verification.

