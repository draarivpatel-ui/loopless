# Security policy

## Reporting a vulnerability

Use the private GitHub Security Advisory form at [Report a vulnerability](https://github.com/draarivpatel-ui/loopless/security/advisories/new). Do not open a public issue, pull request or discussion with exploit details.

Never include a live secret, token, cookie, private key, victim hostname or proprietary payload in a report. Use synthetic values and redacted transcripts.

## Supported versions

| Version | Status |
| --- | --- |
| latest `main` | Supported |

Security fixes are applied to the latest state of the default branch.

## Scope

This policy covers the static LoopLess browser application and its local verification, export and persistence code.

In scope:

- A cross-site scripting or HTML injection path through errand data, route names, share hashes, imported text, calendar output or report output.
- A share-link decoder, serialization flaw or prototype-pollution path that bypasses validation, corrupts another route or executes attacker-controlled code.
- A local persistence or browser worker flaw that misrepresents isolation or sends route data off the device.
- A calendar, JSON, CSV or Markdown export escaping flaw that makes generated output execute a formula or script when opened.
- A validation flaw in deadline, prerequisite, undo or replay handling that silently rewrites user-supplied route data.

Out of scope:

- Browser vulnerabilities, operating system compromise or physical access to the machine.
- Damage caused by modified copies of the static application that do not come from this repository.
- Approximation or modeling limits already documented by the project, unless a report shows a specific validation or output integrity failure.

## Coordinated disclosure

- Acknowledgment: within 3 business days.
- Initial triage: within 14 calendar days.
- Fix or mitigation target: within 90 calendar days for confirmed reports.
- Coordinated public disclosure: up to 90 days by default, adjusted by mutual agreement when exploitation or user risk requires a different date.
