---
name: run
description: Run this project's application from the agent. Detects the project type (Node, Python, Rust, Go, other), the environment (venv, package manager, env files), whether something is already running, and the dev entry point, then starts the app in the background, waits for readiness, and reports the URL, ports, and how to stop it. Use when the user asks to run, start, or launch the app.
---

# Run a project

Start the project's application in its normal development environment and confirm it is actually serving.

## 1. Detect the project type and environment

Check these files in order; the report must name the project type, the package manager or toolchain, and the interpreter/runtime used.

**Node / TypeScript**
- `package.json` — read `scripts`, `engines`, `workspaces`.
- Lockfile decides the package manager:

  | Lockfile             | Package manager |
  | -------------------- | --------------- |
  | `pnpm-lock.yaml`     | pnpm            |
  | `package-lock.json`  | npm             |
  | `yarn.lock`          | yarn            |
  | `bun.lockb`          | bun             |

- `.nvmrc` / `.tool-versions` — expected Node version; compare with `node -v` and report a mismatch.
- `node_modules/` — if missing, install once with the detected package manager and say so.

**Python**
- `pyproject.toml` — build backend (`[build-system]` → uv/poetry/hatch/pdm/setuptools), entry points in `[project.scripts]` / `[tool.poetry.scripts]`, framework hints in dependencies.
- Lockfile: `uv.lock` → uv, `poetry.lock` → poetry, `pdm.lock` → pdm. `Pipfile` → pipenv.
- `.python-version` — expected interpreter version.
- Virtualenv: `.venv/` first, then `venv/` — an existing `bin/python` inside is the environment to use.

**Rust**
- `Cargo.toml` — workspace vs single package; the binary target in `[[bin]]` or `src/main.rs`.

**Go**
- `go.mod` — module and Go version; `go.work` marks a workspace; `cmd/<app>` directories mark entry points.

**Cross-cutting (check for every project type)**
- `Makefile` / `justfile` — a `run`/`dev`/`serve` target is the canonical start command.
- `docker-compose.yml` — the app is containerized, or external services (databases, brokers) are required.
- README "Getting Started" / "Development" section — when in doubt, the project's own instructions win.

## 2. Check the environment before starting

- **Already running?** Check the expected ports (`ss -ltn` or `lsof -i`). If the app is already listening, report the URL and stop — do not start a second instance.
- **Env files**: look for `.env`, `.env.local`, `.env.example`. Required variables missing from the local env file → report what is missing instead of inventing values. Never write `.env` files.
- **External services**: databases or brokers in `docker-compose.yml` that the app needs → suggest `docker compose up -d <service>` and start them when the request allows it.
- **Python venv**: always run through the project's virtualenv when one exists — invoke its binaries directly (`.venv/bin/python`, `.venv/bin/uvicorn`, ...); no `source .../activate` needed. Without a venv, use `uv run` when available. The report states which interpreter and venv were used.
- **Node workspaces**: when the app is one package among many, target it with the package manager's filter (e.g. `pnpm run dev --filter <app-package>`).

## 3. Choose the entry point

Prefer the development server. Production, deploy, and data-migration commands only when the user explicitly names them.

**Node** — script priority: `dev` → `start` → `serve`. Report which script was chosen.
```
pnpm run dev
```
The port comes from the project's config or code (framework defaults: Next 3000, Vite 5173, Express from `app.listen`/env) — read it, do not guess.

**Python** — entry points in `[project.scripts]` / `[tool.poetry.scripts]` first; otherwise the framework:
```
.venv/bin/python -m uvicorn <module>:app --reload    # FastAPI / Starlette
.venv/bin/python manage.py runserver                  # Django
.venv/bin/python -m flask run                          # Flask
.venv/bin/python -m streamlit run app.py              # Streamlit
```

**Rust**:
```
cargo run                    # add --bin <name> / --package <pkg> in workspaces
```

**Go**:
```
go run .                      # or go run ./cmd/<app>
```

**Containerized**: `docker compose up` (dev profile) when the app itself is the container.

## 4. Start in the background and wait for readiness

1. Start the app with the bash tool's background execution — the process must outlive the command.
2. Poll the expected URL/port with `curl -s` (or a TCP check) for up to ~60 seconds.
3. Keep the last ~20 lines of startup output.
4. If the process exits early, report the error tail instead of a URL.

## 5. Report

1. The URL(s) and port(s) the app serves, and how they were determined.
2. The exact command that was started, and the environment used (venv/interpreter, package manager, Node version, env file).
3. How to stop it: the kill command or port, and where its output is streamed.
4. Anything you had to start for it (compose services, installs).

## Safety

- Development profile only by default; never run deploy, migration, or data-destructive commands unless the user names them.
- Do not modify source files, `.env` files, or project data to make the app start.
- If the app cannot start (missing env, missing service, build error), report the blocker with the error output instead of patching around it.
