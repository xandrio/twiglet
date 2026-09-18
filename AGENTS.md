# Working on Twiglet

This file provides repository-wide context for coding agents. Read it alongside
[README.md](README.md), and keep both accurate as the project evolves.

## Project intent and current state

Twiglet is a small personal Git companion, with a CLI first and a possible desktop
interface later. It is exploratory: repository state, recent commits, branch
history, branch differences, and local/remote divergence are initial ideas, not a
closed specification.

At this stage the repository has documentation only. No application architecture,
language, framework, package manager, or test/build commands have been chosen.
Do not treat these gaps as permission to scaffold an application. Architecture is
a separate discussion and should receive human review before implementation.

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

Inspect existing files and tooling before making changes. Once implementation
exists, use the repository's documented build and test commands and add meaningful
coverage appropriate to the behavior changed. For documentation-only edits, check
accuracy, consistency, links, and the diff; no application tests currently exist.

Report what changed, the validation performed, and any remaining limitations.
Distinguish checks actually run from expectations, especially for platforms you
could not test. Update setup and usage documentation when working commands become
available, and remove stale statements about the repository's early state.
