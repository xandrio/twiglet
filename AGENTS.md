# Working on Twiglet

This file provides repository-wide context for coding agents. Read it alongside
[README.md](README.md), and keep both accurate as the project evolves.

## Project intent and current state

Twiglet is a small personal Git companion, with a CLI first and a possible desktop
interface later. It is exploratory: repository state, recent commits, branch
history, branch differences, and local/remote divergence are initial ideas, not a
closed specification.

## Approved architecture and distribution

- Use TypeScript/Node and installed Git, with a single npm package and lockfile.
  The maintainer's TypeScript familiarity is a significant maintenance constraint.
- Keep reusable repository types and operations in `src/core`, Git execution and
  parsing in `src/git`, and interactive navigation/rendering in `src/terminal`.
  `src/cli.ts` owns arguments and process-level behavior. Core code must not prompt,
  print, change global working directories, or exit the process.
- The primary experience is `tl` -> Repository overview or Recent commits, with
  Refresh/Back navigation. Direct `status` and `log --limit N` share core operations.
- Call Git with argument arrays, never shell commands. Inspection must neither
  mutate repositories nor contact remotes. Account for optional index writes,
  partial-clone lazy fetching, external helpers, and inherited Git environment.
- Commit the generated directly runnable JavaScript distribution and required
  third-party notices alongside source. No target-machine npm install, build,
  node_modules, new runtime, standalone executable, or runtime download is allowed.
  Development machines may use normal npm dependencies and build/test tooling.
- Rebuild distribution with runtime changes and verify deterministic output in CI.
  Test the actual artifact in isolation without node_modules, not just source.
- A richer TUI and likely Electron/web desktop are future possibilities. Keep UI
  boundaries clean without adding desktop code, RPC, or a framework in anticipation.
- The primary target Node version has not yet been supplied: the initial value was
  a placeholder. Document the supported floor and versions actually validated;
  do not claim target-machine compatibility until its version is known.

Current runtime floor: Node 22. Development: `npm ci`, `npm run dev`.
After runtime changes: `npm run build`, then `npm run check` (typecheck, distribution
freshness, and tests). Commit generated `dist/` files with source. The target
machine runs `node /path/to/twiglet/dist/twiglet.cjs` with no preparation.

The first overview deliberately excludes submodule worktrees, rejects partial-clone
configuration, and disables external clean/process filters (which may make filtered
paths appear modified). Do not remove these guards without preserving offline,
non-mutating inspection. Fatal inspection/argument errors exit 1; cancellation exits
130. Upstream comparison is supplementary: failures appear as unavailable information
and do not fail an otherwise useful overview (including direct `status`, exit 0).

Milestone 2 adds bounded history reachable from captured HEAD (including merged
history) and divergence against the configured, locally available upstream. Resolve
refs to full IDs; distinguish absent config, missing refs, shallow history, detached/
unborn HEAD, races, and operational errors. Never replace unavailable counts with 0
or imply remote freshness. Local-branch upstreams need no remote-freshness claim.
History must not scan the worktree or calculate divergence. Refresh reads local
state only. No network access, watch service, pagination, graph, or desktop scope.

## Collaboration and decisions

- Humans guide goals, scope, priorities, and major architectural decisions.
- Agents own routine implementation details, code organization, and testing
  approaches within the agreed direction. Use judgment rather than seeking
  approval for every low-level decision.
- Before substantial implementation, present a concise plan covering the intended
  outcome, scope, important tradeoffs, and validation approach, then wait for
  review. Examples include choosing the initial stack, introducing a major
  dependency, or significantly expanding behavior or structure.
- Small, well-contained changes can usually be implemented directly. Summarize
  what changed and how it was checked afterward.
- Ask when ambiguity affects scope or a major decision. Resolve ordinary details
  yourself, and explain consequential assumptions.
- Keep work focused and preserve unrelated local changes. Avoid adding process,
  abstraction, or documentation solely for completeness.

## Engineering guardrails

- Keep Twiglet generic. Do not encode employer-specific workflows, proprietary
  conventions, ticket formats, fixed branch names, or assumptions about a single
  Git hosting provider.
- Consider Windows, macOS, and potentially Linux. Account for paths, quoting,
  shells, encodings, and line endings; avoid depending on one developer's machine
  layout or shell without an explicit reason.
- Keep repository inspection predictable. Distinguish working-tree, local Git,
  and remote-tracking information; do not imply that locally available remote
  information is necessarily current.
- Do not introduce silent repository mutations or network activity as a side
  effect of displaying information. Any such behavior needs deliberate design.
- Favor simple solutions and dependencies justified by an actual need. Do not
  build desktop infrastructure in anticipation of an undesigned UI.
- Treat feature ideas as open to discussion while keeping scope proportionate to
  a lightweight personal tool.

## Validation and handoff

Inspect existing files and tooling before making changes. Use the repository's
documented build and test commands and add meaningful coverage appropriate to the
behavior changed. Use real Git in isolated temporary repositories for semantic
tests and keep terminal behavior separately testable. For documentation-only
edits, check accuracy, consistency, links, and the diff.

Report what changed, the validation performed, and any remaining limitations.
Distinguish checks actually run from expectations, especially for platforms you
could not test. Update setup and usage documentation when working commands become
available, and remove stale statements about the repository's early state.
