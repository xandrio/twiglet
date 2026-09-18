# Twiglet

Twiglet is a small, lightweight companion for working with Git repositories. Its
first focus is a terminal/CLI experience that makes everyday repository information
quick to understand.

This is an early-stage personal project intended to be open source. `tl` opens an
interactive menu for repository overview, recent commits, and local branch
exploration and comparison, with locally known upstream divergence. Views offer
Refresh and Back.

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

Use the arrow keys and Enter to select **Repository overview**, **Recent commits**,
or **Local branches**. Select a branch to inspect it without checking it out.
From its navigation menu, choose **Compare with another branch…**. The selected
branch is B (inspected); choose another local branch as A (reference).
**Refresh** rereads local information without fetching; **Back** returns to the menu
with your previous selection retained. **Exit** closes Twiglet. Ctrl-C cancels and
restores the terminal.

Terminal output uses subtle emphasis for branches, commits, metadata, and diagnostics.
Redirected output stays plain; `NO_COLOR=1`, `TERM=dumb`, or `FORCE_COLOR=0` disables
styling. Color supplements the existing labels and markers; full upstream refs and
inspection caveats remain visible.

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
tl log
tl log --limit 50
tl branches
tl branch feature/example
tl compare main feature/example
tl compare main feature/example --view commits-b
tl compare main feature/example --view tips
tl compare main feature/example --view since-base
tl --repo /path/to/another/repository
tl --help
tl --version
```

`status`, `log`, `branches`, `branch <name>`, and `compare A B` print once. `branch` accepts an exact
local branch name, not a revision expression or remote-only reference. All commands
support `--repo`. `log` defaults to 20 commits; `--limit` accepts 1–100
and is only valid with `log`. Bare `tl` also prints once when input/output is redirected
or the terminal declares itself `dumb`; it never waits for an invisible menu.
Normal exit is 0, fatal command/inspection errors are 1, and cancellation is 130.
An unavailable upstream comparison is supplementary information: `status` still
prints the useful overview and exits 0, with a visible explanation. Similarly,
`branch` preserves branch metadata if history or comparison fails, with a diagnostic
and exit 0. Missing branches and detected ref changes fail with exit 1. Interactive
inspection errors stay in the session so you can Refresh, go Back, or Exit.

`compare A B` also accepts only exact local names. Its default summary shows both
full refs, captured tip IDs, unique commit counts, and merge-base information.
`--view commits-a` and `--view commits-b` show the latest 20 commits reachable only
from the named side, including merged ancestry. This is commit reachability, not
patch equivalence: cherry-picked or otherwise equivalent patches can still have
different commit identities. Distinct histories can produce identical tip trees.

`--view tips` shows committed file changes from A's tip to B's tip. `--view since-base`
shows net changes from their single merge base to B's tip. These are different
endpoints; neither predicts what a merge would produce. A merge base is not
necessarily the historical branch-creation point. File views show statuses, full
paths, rename source/destination and similarity, and submodule-pointer labels.
They show up to 50 changed paths with an exact total; no patch hunks or line counts.
Renames use Git's 50% similarity threshold and an exhaustive-search limit of 1000
candidates; candidates beyond that limit may remain additions/deletions.

Interactive comparison loads details on demand and offers Swap A and B, Refresh,
and Back. Swapping keeps the captured tips; Refresh captures both again. Ref movement
or deletion is reported rather than silently mixing snapshots. No working-tree
changes, checkout, network activity, external diff helper, or text conversion is
involved. Dirty or unreadable indexes do not affect committed comparisons.

Unrelated histories retain unique-commit and tip views but have no merge-base view.
Multiple merge bases are listed without choosing one arbitrarily. Shallow history
withholds reachability and merge-base conclusions while allowing tip comparison
when objects exist. Unborn branches require a first commit. A useful partial summary
exits 0; an explicitly requested view that cannot be produced exits 1 with a reason.
Ordinary differences exit 0. Independent summary sections remain usable on failure.

## Current scope and limits

The overview shows repository location, attached/unborn/detached HEAD, configured
upstream divergence, and grouped staged, unstaged, conflict, and untracked entries.
It works from nested directories and linked worktrees. Location is the absolute worktree root reported by Git,
not the invocation directory or its original spelling. Symlinks and Windows short
directory names may resolve to a different spelling of the same physical directory.
Untracked directories are grouped and each change group
shows at most 30 entries; a path can be both staged and unstaged.

Ahead/behind counts compare captured HEAD with the configured upstream reference
stored locally, using Git's mapping (including custom remotes and local-branch
upstreams). Ahead means commits reachable only from HEAD; behind means commits
reachable only from the upstream. Equal counts mean the local references match,
not that a server is current. Remote freshness is always unknown: Twiglet neither
fetches nor infers freshness from timestamps. Absent configuration, missing local
refs, unresolved configuration, detached/unborn HEAD, incomplete shallow history,
HEAD changes during inspection, and comparison errors have explicit states;
unavailable counts are never shown as zero.

Recent commits show history reachable from captured HEAD, including merged ancestry,
in Git's date order. Entries include an abbreviated ID, subject, author, commit
timestamp with offset, and a merge marker where applicable. The reusable core keeps
full IDs and parent IDs. Unborn branches have an empty history; detached HEAD and
shallow history work, with shallow history labelled as incomplete. History reads
neither the working-tree status nor upstream divergence. There is no pagination,
graph, or commit-detail view yet.

Local branches are ordered with the current branch first, then newest tip commit
date, with name as a tie-breaker. The list includes shortened subjects and tracking
relationships; tip dates do not indicate when a branch was last used. The selector
scrolls, with Back and Refresh above the branches. Returning or refreshing retains
the selected reference if it still exists. Refresh rereads local state only.

Selected-branch details show the complete tip subject, author, timestamp and ID,
locally known upstream divergence, and the latest 20 reachable commits. They neither
check out the branch nor scan the working tree. Unborn branches show no commits;
detached HEAD has no current local branch. “Current” refers only to the inspected
worktree. A branch moved or deleted during inspection produces a Refresh diagnostic.
Listing uses bulk metadata queries; history and divergence are loaded only for the
selected branch. Remote-branch browsing, filtering, worktree inventory, arbitrary
revision comparisons, and branch mutations are not included.

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
Linux. Milestone 1 passed that matrix. Each subsequent change still needs its own
CI run; local Windows validation does not substitute for macOS/Linux execution.
The suite covers real commit graphs, local and remote-tracking upstreams, incomplete
and unavailable information, refresh/error navigation, and the isolated distribution.

Milestone 2 was validated locally on Windows with Node 22.16.0 and 24.20.0 and Git
2.43.0.windows.1: all 42 tests, type checking, and distribution freshness checks
passed on both Node versions. The native terminal also exercised both views,
Refresh, Back, Exit, and cancellation. Its macOS/Linux CI validation is pending.

Milestone 3 passed all 49 tests, type checking, and distribution freshness checks
on Windows with Node 22.16.0 and 24.20.0 and Git 2.43.0.windows.1. This includes
branch navigation and commands from an isolated checkout without installation.
The existing six-job CI matrix still needs to confirm this milestone after push.

Milestone 4 passed all 62 tests, type checking, and distribution freshness checks
on Windows with Node 22.16.0 and 24.20.0 and Git 2.43.0.windows.1. Comparison tests
cover real commit graphs, independent partial failures, ref changes, file statuses,
and isolated distribution/navigation. The six-job CI matrix still needs to run for
this milestone after push; local Windows validation does not confirm other OSes.

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

Milestone 4 adds explicit local-branch comparison views. A focused file-patch viewer
is a possible next step after trying comparison in real repositories. Graphs,
patch-equivalence analysis, and merge-conflict prediction remain outside scope.

## License

An open-source license has not yet been selected. The intention to release Twiglet
as open source does not itself grant a license; a license file will be added once
that choice is made.
