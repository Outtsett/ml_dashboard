# Security Policy

## Reporting a Vulnerability

This repository is published under a **Source-Available View-Only License**
(see `LICENSE`). It is not intended to be cloned, deployed, or run by third
parties.

If you discover a security issue while viewing the source — for example, an
accidentally committed secret, a hardcoded credential, or a vulnerability in
the publicly readable code — please report it privately:

1. Open a **GitHub Security Advisory** on this repository
   (Security → Report a vulnerability), **or**
2. Contact the repository owner via the email address listed on the GitHub
   profile that owns this repository.

Please **do not** open a public issue, file a pull request, or post to social
media before the issue is resolved. Doing so may put users of any future
deployments at risk.

## Scope

In-scope:

- Hardcoded secrets, tokens, or credentials inadvertently committed to this
  repository (current branch or git history).
- Personally identifying information (PII) inadvertently committed.
- Insecure default configurations baked into source files.
- Vulnerabilities in code paths a reader could reasonably reproduce by
  reading the public source.

Out-of-scope:

- Unauthorized clones, forks, or deployments by third parties.
  Such usage is prohibited by the license; the copyright holder makes no
  representations or warranties about its security.
- Findings in third-party dependencies. Report those upstream.
- Theoretical issues without a clear demonstration of impact.

## Response

The repository owner will acknowledge a valid report within 7 days and will
work in good faith to remediate confirmed issues. Reporters who follow this
process will be credited in the commit log unless they request otherwise.

## Secret Handling

The following layers protect this repository against accidental secret
exposure:

1. **`.gitignore`** — strict patterns covering `.env`, `*.secrets`, `*.pem`,
   `*.key`, `credentials*`, and other sensitive paths.
2. **GitHub secret scanning** — enabled by default on public repositories;
   alerts on commits containing recognized provider tokens.
3. **GitHub push protection** — blocks pushes containing detected secrets.
4. **Pre-commit hooks** — `gitleaks` / `trufflehog` recommended for
   contributors; configure in `.husky/pre-commit`.
5. **Environment-only configuration** — runtime secrets are loaded from the
   local `.env` (gitignored) and an out-of-tree `.env.secrets` file. Only
   `.env.example` (with placeholder values) is ever committed.

If a secret is found in the repository, including in historical commits,
report it via the channels above and the owner will rotate the credential
and rewrite history (`git filter-repo` or BFG Repo-Cleaner) to remove it.
