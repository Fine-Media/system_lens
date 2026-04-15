# Contributing to System Lens

Thank you for your interest. This project aims to stay **local-first**, **transparent**, and **safe by default**. Contributions that match that spirit are especially welcome.

## Issue backlog

Maintainers can copy concrete open work from **[docs/project/GITHUB_ISSUES_TO_CREATE.md](docs/project/GITHUB_ISSUES_TO_CREATE.md)** into GitHub (titles, labels, and bodies). See also **[docs/project/first-20-github-issues.md](docs/project/first-20-github-issues.md)** for the milestone roadmap.

## Ways to contribute

- **Issues:** Bug reports, feature ideas, documentation gaps, and maintenance tasks (see [Issue kinds](#issue-kinds) below).
- **Pull requests:** Fixes and features with a clear scope; prefer small, reviewable PRs.
- **Reviews:** Thoughtful code review and design feedback help even without writing code.
- **Documentation:** README accuracy, runbooks, architecture notes, and onboarding for new contributors.

## Issue kinds

We use separate templates so work is easy to triage:

| Kind | Template | Use when |
|------|----------|----------|
| **Bug** | Bug report | Something regressed or is incorrect. |
| **Feature** | Feature request | New capability or meaningful UX improvement. |
| **Task / chore** | Task / chore | Refactors, tests, CI, deps, performance, internal cleanup. |
| **Docs** | Documentation | Clarifying setup, trust model, or contributor flow. |

You can still open a **blank issue** if none of the templates fit.

### Suggested labels (for maintainers)

Creating labels in the GitHub repo settings helps filtering. Examples:

- `bug`, `feature`, `docs`, `task`, `good first issue`, `help wanted`, `priority: high`
- Area: `area:desktop`, `area:indexer`, `area:search`, `area:insights`, `area:assistant`, `area:safety`, `area:db`

## Development setup

Follow the [README](README.md) **Run the project** section:

1. `npm install` (repository root)
2. `npm run build`
3. `npm --workspace @system-lens/desktop start`

Optional: [Ollama](https://ollama.com/) for embeddings and assistant features (see README env vars).

## Project layout

- `apps/desktop` — HTTP server and static UI (MVP shell).
- `packages/*` — Shared libraries (indexer, search, shared-db, insights, assistant, safety, automation, logger).

Keep changes **focused** on the problem you are solving. Avoid drive-by refactors in unrelated files.

## Pull requests

1. **Branch from `main`** (or the default branch) with a descriptive name.
2. **Describe** what changed and why; link related issues.
3. **Build:** `npm run build` must pass before merge.
4. **Scope:** One logical change per PR when possible; large features can be split.

We use the [pull request template](.github/pull_request_template.md) to keep reviews efficient.

## Code style

- **TypeScript** with `strict` settings; match existing patterns in touched files.
- **No secrets** in commits (API keys, personal paths, tokens).
- Prefer **clear names** and **small functions** over clever one-liners.

## Community

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Be respectful and assume good intent.

## Security

If you find a security vulnerability, **do not** open a public issue. See [SECURITY.md](SECURITY.md) for how to report it privately.
