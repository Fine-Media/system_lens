# Security policy

## Supported versions

Security fixes are applied to the **default branch** (usually `main`) forward. There are no separate LTS release lines yet; tag maintainers if you need a backport for a specific release.

## Reporting a vulnerability

**Please do not** file a public GitHub issue for security vulnerabilities.

Instead:

1. Open a **private** [GitHub security advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) for this repository, if the feature is enabled by maintainers, **or**
2. Contact the repository maintainers through a private channel they specify in the README or org profile.

Include:

- A short description of the issue and its impact
- Steps to reproduce (if safe to share)
- Affected components (e.g. `apps/desktop`, `packages/search`) if known

We will acknowledge receipt as soon as we can and work on a fix and disclosure timeline with you.

## Scope

In scope: the code in this repository as shipped (desktop server, packages, scripts). Out of scope: third-party services you configure (e.g. Ollama, OS sandboxing) except where we document an unsafe default.
