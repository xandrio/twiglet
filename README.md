# Twiglet

Twiglet is a small, lightweight companion for working with Git repositories. Its
first focus is a terminal/CLI experience that makes everyday repository information
quick to understand.

This is an early-stage personal project intended to be open source. The first
milestone is an interactive walking skeleton: `tl` opens a menu, Repository
overview inspects the current repository, and Back returns to the menu.

## Technical direction

Twiglet uses TypeScript and Node, with the installed Git executable providing Git
semantics. Repository operations return structured data independently of terminal
interaction. The interactive terminal is the primary experience; direct commands
are also useful. A future richer TUI or web-based desktop experiment should reuse
repository operations without determining today's UI implementation.

Maintainer familiarity with TypeScript is an important design constraint for this
personal project. Keep the project small and use ordinary npm development tools.

The primary distribution is checked-in, generated JavaScript, including runtime
dependencies. A checkout must run using existing Node and Git without npm install,
node_modules, a build, a bundled runtime, or a new native executable. Developers
rebuild the distribution with source changes; CI verifies that it is current.
The target machine's Node version still needs confirmation (the supplied version
was a placeholder); compatibility claims must state the versions actually tested.

## Run from a checkout

Requirements: **Node 22 or newer** and Git on PATH (validated locally with Git
2.43 for Windows). The exact Node version on the primary usage machine is still
unconfirmed. Nothing is installed or downloaded when Twiglet runs.

From the repository you want to inspect, run:

```text
node /path/to/twiglet/dist/twiglet.cjs
```

Use the arrow keys and Enter to select **Repository overview**, then **Back**, then
**Exit**. Ctrl-C cancels and restores the terminal. Reopen the overview to refresh.

A short PowerShell function can point to your Twiglet checkout:

```powershell
function tl { & node 'C:\tools\twiglet\dist\twiglet.cjs' @args }
```

For bash or zsh:

```sh
tl() { node "$HOME/tools/twiglet/dist/twiglet.cjs" "$@"; }
```

Replace the example path with your checkout. Define the function in the current
shell, or add it to your own shell profile for persistence. It preserves the
caller's working directory and forwards arguments; no global npm package is needed.
Update Twiglet with a normal pull in its checkout; do not edit `dist/` directly.

```text
tl status
tl --repo /path/to/another/repository
tl --help
tl --version
```

`status` prints once. Bare `tl` also prints once when input/output is redirected
or the terminal declares itself `dumb`; it never waits for an invisible menu.
Normal exit is 0, command/inspection errors are 1, and cancellation is 130.
Interactive inspection errors stay in the session so you can go Back and Exit.

## Current scope and limits

The overview shows repository location, attached/unborn/detached HEAD, configured
upstream, and grouped staged, unstaged, conflict, and untracked entries. It works
from nested directories and linked worktrees. It does not fetch or calculate
ahead/behind counts yet. Location is the absolute worktree root reported by Git,
not the invocation directory or its original spelling. Symlinks and Windows short
directory names may resolve to a different spelling of the same physical directory.
Untracked directories are grouped and each change group
shows at most 30 entries; a path can be both staged and unstaged.

Inspection disables optional index writes, filesystem-monitor helpers, and external
clean/process filters without changing configuration. Filtered paths may consequently
appear modified. Submodule worktrees are excluded. Bare repositories and any
partial-clone/promisor configuration are explicitly rejected for now. Shallow
repositories are identified. Queries have a 15-second timeout and 16 MiB output
limit; the combined overview is not an atomic snapshot if another tool changes Git.

Git ownership checks remain in force. Twiglet never changes `safe.directory` or
other Git settings to bypass an error. Inherited `GIT_*` variables are cleared so
they cannot silently redirect inspection; use `--repo` to select the worktree.

## Development and validation

Only development machines need npm dependencies:

```text
npm ci
npm run dev
npm run build
npm run check
```

`check` runs TypeScript checking, verifies that the generated distribution matches
source and locked dependencies, and runs the test suite. Build with the pinned
dependencies before checking in runtime changes. Commit `dist/twiglet.cjs` and
`dist/THIRD_PARTY_NOTICES.txt` together with their source changes. Builds are
unminified, contain no machine paths or timestamps, and reject unbundled package
imports. No runtime, development tooling, or node_modules is included in `dist/`.

Tests create disposable real Git repositories and clone a snapshot of the candidate
files to exercise the artifact without installation. Terminal-like stream tests
exercise the bundled prompt and cancellation; these are distinct from native
terminal smoke tests. The CI workflow runs Node 22 and 24 on Windows, macOS, and
Linux. Configuring that matrix does not mean those jobs have already run.

Milestone 1 was validated on Windows with Node 22.16.0 and 24.20.0 and Git
2.43.0.windows.1: 25 tests passed on each Node version, including the isolated
clone and bundled menu tests. A native terminal walkthrough also exercised
Overview -> Back -> Exit and Ctrl-C cleanup. macOS/Linux execution remains to
be confirmed by CI. Node 20 was checked only for the clear unsupported-version
message, not for application compatibility.

## Direction

Initial areas to explore include:

- Repository state and working-tree changes.
- Recent commits and branch history.
- Differences between branches.
- Local/remote divergence.

These are starting points, not a fixed feature specification. Twiglet should stay
small and useful without reproducing every Git capability or competing with full
Git clients. New ideas are welcome when they fit that intent.

The CLI comes first. A desktop interface may be explored later, but it has not been
designed and is not part of the initial implementation scope.

## Principles

- **Generic Git workflows:** avoid assumptions about employers, organizations,
  private repositories, ticket formats, or branch naming conventions.
- **Hosting independence:** aim to work across repositories and Git hosting
  providers without requiring a particular service.
- **Cross-platform use:** account for Windows and macOS, with Linux use in view.
  Development on one platform should not silently constrain the others.
- **Keep it enjoyable:** favor focused improvements and proportionate engineering
  over unnecessary dependencies, process, or documentation.

## Working on Twiglet

Humans guide goals, scope, priorities, and major architectural decisions. Coding
agents generally own implementation details, code organization, and testing
approaches within that direction.

For substantial changes, propose a plan for review before implementation. Small,
well-contained changes can usually be made directly and summarized afterward.
See [AGENTS.md](AGENTS.md) for practical guidance for coding agents.

The approved first milestone is the interactive overview. Recent commits, richer
branch exploration, and comparisons follow after that workflow is useful.

## License

An open-source license has not yet been selected. The intention to release Twiglet
as open source does not itself grant a license; a license file will be added once
that choice is made.
