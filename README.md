# Twiglet

Twiglet is a small, lightweight companion for working with Git repositories. Its
first focus is a terminal/CLI experience that makes everyday repository information
quick to understand.

This is an early-stage personal project intended to be open source. `tl` opens an
interactive menu for repository overview, recent commits, and local branch
exploration and comparison, with locally known upstream divergence. Views offer
Refresh and Back. An optional, explicitly online Bitbucket Cloud action checks PRs
using user-local configuration; local Git inspection remains independently useful.

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
tl compare main feature/example --view tips --file src/example.ts
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
Direct file lists show up to 50 changed paths with an exact total. Interactive file
inspection provides pages of 50 paths and patch pages of 80 lines.
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

## File inspection (Milestone 5)

In either comparison file view, choose **Inspect a file…**, then a changed file.
Next/Previous file pages reach every change; Back to files retains your selection.
Patch pages show 80 lines at a time. Refresh comparison captures new tips and clears
old file selections. All views retain full branch refs and actual before/after IDs.

`tl compare A B --view tips|since-base --file <path>` prints a single file inspection
without prompts. Use an exact repository-root-relative Git path (forward slashes),
not a glob: the destination for renames or original path for deletions. This also
finds changes beyond the first 50 entries. Missing or unavailable patches exit 1;
binary and metadata-only inspections are successful. Redirected output stays plain.

Text patches use three context lines. The file header preserves modes, blob IDs,
rename names and similarity. Pure renames and mode-only changes need no content
hunks; binary files show a notice rather than a binary payload. Submodule changes
show recorded pointers/modes without visiting submodule contents. Symlink changes
inspect stored targets, never the files they point to.

Patches are inspection output, not apply-ready exports. Terminal controls and tabs
are escaped. Non-UTF-8 patch content is unavailable rather than silently replaced;
non-UTF-8 added/deleted paths cannot currently be queried, but remain identifiable
by raw bytes in the file list. Modified/renamed content is compared using captured
blob IDs, preserving the selected rename pairing. These blob comparisons use Git's
content-based binary detection without path-specific text conversion/diff drivers.

A selected patch exceeding 1 MiB is unavailable; no partial patch is shown. Existing
15-second and 16 MiB Git-query limits also apply. Patch errors leave the comparison
session usable. No external helpers, network, checkout, index scan, or repository
writes are involved. Commit-detail navigation and patch application remain deferred.


## Bitbucket Cloud PR check (Milestone 6)

`tl pr --online` explicitly checks Bitbucket Cloud for pull requests associated with
the current committed local branch. In the main menu, choose **Check Bitbucket PRs
(online)**. Results offer **Check again (online)** and Back; multiple matches have a
selector. Browsing returned results makes no additional requests. `tl status` and
all existing Git views remain offline, and do not read provider configuration.

Create a user-local JSON file outside repositories:

- Windows: `%APPDATA%/Twiglet/config.json` (fallback: the user's AppData/Roaming).
- macOS/Linux: `$XDG_CONFIG_HOME/twiglet/config.json`, or `~/.config/twiglet/config.json`.
- `TWIGLET_CONFIG` can explicitly override the file location.

```json
{
  "version": 1,
  "bitbucketCloud": {
    "email": "developer@example.com",
    "tokenRef": { "source": "env", "name": "TWIGLET_BITBUCKET_TOKEN" }
  },
  "repositories": [
    {
      "path": "C:/work/example",
      "bitbucketCloud": {
        "workspace": "example-workspace",
        "repository": "example-repository"
      }
    }
  ]
}
```

Use an absolute worktree-root path and Bitbucket Cloud workspace/repository slugs.
Paths are matched by canonical directory spelling, including nested invocation and
aliases. Each linked worktree needs its own explicit mapping. Remote URLs are not
used to guess mappings. Duplicate mappings and unknown config fields are errors.
The file is limited to 256 KiB. No config file is automatically created or modified.

This example uses the universal environment fallback for CI, headless use, or a
temporary session. For persistent desktop use, OS credential storage is recommended
where supported (see below). Use the Atlassian account email and a user-scoped Bitbucket API token
with `read:pullrequest:bitbucket`; the user must have access to the mapped repository.
This uses Basic authentication over HTTPS to `api.bitbucket.org`.
See [Bitbucket Cloud authentication](https://developer.atlassian.com/cloud/bitbucket/rest/intro/).
Do not put tokens in JSON, repository files, or command arguments. Email is a
non-secret identity field. Twiglet does not log raw API errors or authorization.

### Credential sources and local diagnostics

Existing version-1 `emailEnv` / `tokenEnv` configuration remains supported; files
are never automatically rewritten. New configuration should normally use direct
`email` plus `tokenRef`. Exactly one of `email` / `emailEnv` and exactly one of
`tokenRef` / `tokenEnv` is allowed. Literal token/password fields are rejected.
Environment references must use dedicated names, not execution/session settings
such as `PATH`, `HOME`, proxy settings, or `SSH_AUTH_SOCK`.

The following alternatives replace just `tokenRef`:

```json
{ "source": "macos-keychain", "service": "twiglet.bitbucket", "account": "personal" }
```

```json
{ "source": "linux-secret-service", "account": "personal" }
```

macOS reads an existing generic-password item matching the service/account using
`/usr/bin/security`. Linux reads an existing Secret Service item matching attributes
`application=twiglet` and `account=personal`, using an already-installed
`/usr/bin/secret-tool` or `/bin/secret-tool`. Use a unique matching item. These
selectors are non-secret identifiers. Neither adapter searches arbitrary executables
on PATH, installs software, writes credentials, or changes store access settings.
The user provisions items separately using trusted OS tools; never put a token in
a provisioning command's arguments. Store access may trigger an OS permission or
unlock prompt. Corporate policy, a locked store, or a missing desktop/session bus
can prevent access. Lookup failure remains explicit; there is **no automatic
fallback**, even when an environment token is available.

Windows native credential-store support is not yet implemented. Environment
references remain supported there, but are not the recommended persistent storage
mechanism. Twiglet never writes environment credentials into shell/PowerShell
profiles, registry settings, `.env` files, configuration, or other persistent files.
No OS helper is needed for the environment fallback or offline Git commands.

```text
tl doctor
tl doctor --check-credentials
```

Doctor inspects local configuration for the selected worktree. Its default mode
distinguishes a configured reference, environment-variable presence, and adapter
availability; it does not retrieve OS credentials or claim authentication works.
`--check-credentials` explicitly resolves the local credential and may prompt via
the OS. Neither mode contacts Bitbucket or makes provider/network requests.
Diagnostics never show values, fragments, lengths, or fingerprints of credentials.
Environment-source guidance is advisory. Missing setup is valid for offline use;
invalid setup, a missing configured env value, or an unavailable/failed source
exits 1. Successful checks and advisories exit 0; cancellation exits 130.

Credential lookup is bounded to 15 seconds and 16 KiB combined helper output.
Helper stderr is discarded; unavailable adapters and lookup failures are explicit,
but a denied/locked/missing item cannot always be distinguished reliably by the
utilities. API tokens must be nonempty UTF-8 text without control characters.
OS stores protect persistent storage; they are not isolation from a compromised
user session, privileged process, or Twiglet itself. The in-memory secret wrapper
prevents accidental serialization, not guaranteed memory erasure.

All child processes use a reviewed environment policy rather than inheriting every
application variable. Git retains executable lookup, home/XDG configuration, temp,
locale, certificate paths, proxy settings, SSH-agent references, and Windows system
paths. Existing `GIT_*` injection guards remain; Node/dynamic-loader injection
variables are not forwarded. Credential-store helpers additionally receive desktop
session variables. Configured credential references are centrally excluded, and
arbitrary provider variables are absent even before config loads. OS-resolved
tokens are never put into `process.env`. This policy does not sanitize secrets a
user independently placed in Git configuration, proxy URLs, or repository content.

Search scope is **same-repository PRs, exact source branch name, all PR states**.
Source repository identity is checked as well as branch name; fork/cross-repository
PR discovery is not included. Branch names are not inferred from upstream mappings.
A matching PR does not establish that local HEAD equals its source tip. Detached or
unborn HEAD cannot be associated and makes no API request. HEAD changes during the
check invalidate the association. No branch, ref, configuration or index is changed.

Each PR shows identity, title, native state, URL, source/destination repository and
branch, API-reported source/destination tip hashes, and page observation time.
Bitbucket may return 12-character abbreviated hashes; these are labeled as
abbreviated and preserved without additional requests to resolve full IDs.
Those tips are PR data, not local remote-tracking refs or independently checked live
branch tips. Observation time is when Twiglet received data, not a fetch timestamp.
Pages are separate observations, not an atomic remote snapshot. Missing fields are
labelled unavailable; unresolvable source identities make the search incomplete.

Checks are GET-only, cancellable, bounded to 30 seconds, 10 pages of 50 results, and
1 MiB per page. Redirects and pagination outside the expected API origin/endpoint
are rejected. There are no automatic retries, persistent cache, background checks,
Git fetch/pull operations, divergence calculations, PR checks, or issue integrations.

A completed search exits 0, including zero or multiple matches. Not configured,
invalid/missing credentials, detached/unborn/changed context, provider errors and
incomplete searches exit 1; cancellation exits 130. Authentication/access failures
never mean “no matching PR.” Interactive errors leave Back/Check again available.
No provider setup or credentials are required for offline Git use.

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

Milestone 5 passed all 67 tests, type checking, and distribution freshness checks
on Windows with Node 22.16.0 and 24.20.0. Isolated distribution tests exercise
direct file patches and interactive file selection without installation. The
existing six-job CI matrix still needs to confirm this milestone after push.

Milestone 6 passed all 73 tests, type checking, and distribution freshness checks
on Windows with Node 22.16.0 and 24.20.0. Tests use fake HTTP responses and disposable
Git repositories, including isolated bundled direct/interactive online actions and
offline behavior with broken provider configuration. A stalled fake transport also
verified the 30-second deadline. A subsequent live check against a disposable
Bitbucket repository confirmed PR discovery and exposed 12-character API tip
hashes; the adapter now preserves and labels these abbreviations. Live Bitbucket
validation and the Windows/macOS/Linux CI matrix were subsequently accepted.

Milestone 6.5 passed all 82 tests, type checking, and distribution freshness checks
on Windows with Node 22.16.0 and 24.20.0. This includes synthetic credential-source
failures, private helper output, cancellation/timeouts, child-environment isolation,
local-only doctor, and isolated bundled execution without node_modules. No live
Bitbucket credentials or real OS stores were used. The new six-job CI run and
manual macOS/Secret Service permission/prompt behavior remain to be confirmed.

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

Milestone 5 adds file-patch inspection to explicit local-branch comparisons.
Optional providers extend the local Git foundation through explicit configuration.
Bitbucket Cloud is the first integration; issue/environment providers and commit
details remain future work. No employer-specific workflow belongs in the core. Graphs,
patch-equivalence analysis, and merge-conflict prediction remain outside scope.

## License

An open-source license has not yet been selected. The intention to release Twiglet
as open source does not itself grant a license; a license file will be added once
that choice is made.
