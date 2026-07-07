# Security policy

`docs/SECURITY.md` describes the **project's internal threat model and required mitigations** for developers. This file describes **how to report a security concern** as an external user.

## Reporting a vulnerability

**Do not open a public issue for security-sensitive reports.**

Please use one of the following private channels:

- GitHub's [private vulnerability reporting](../../security/advisories/new) — preferred.
- Direct message the repo owner via the contact on their GitHub profile.

Include as much detail as you can:

- A short description of the issue and the impact.
- Reproduction steps or a proof-of-concept.
- Affected version / commit SHA.
- Whether the issue is exploitable in the self-hosted mode, the local-only mode, or both.

## Scope

This project is a self-hosted, low-traffic hobby app. There is no bug bounty. That said, reports are appreciated and will be acknowledged.

In-scope areas:

- Authentication and session handling (Auth.js + Discord OAuth + email OTP).
- Authorization / permissions (party membership, DM / player / banker roles).
- Data handling: currency math, item / stash invariants, JSON import.
- Client-controlled input reaching server routes or the Zustand store.
- Realtime WebSocket boundary.

Out of scope (unless there is a concrete exploit demonstrated):

- Denial-of-service by an authenticated party member against their own party.
- Vulnerabilities in third-party dependencies that are already tracked by Dependabot.
- Behavior that requires a compromised host / server operator.

## Response expectations

This is a solo-maintained project — response times are best-effort. Critical issues (data loss, unauthenticated access, currency theft between parties) will be prioritized.
