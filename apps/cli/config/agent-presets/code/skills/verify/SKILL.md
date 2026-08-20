---
name: verify
description: Verify the project in the current workspace. Detects the project type (Node, Python, Rust, Go, other), the package manager and environment (venv, Node version, lockfiles, env files), then runs the right checks (typecheck, lint, tests) and reports the result. Use when the user asks to verify, validate, or check that the project works after code changes.
---

# Verify a project

Run the project's own checks in the workspace and report the outcome. You do not fix anything: verification is read-only plus executing the project's check commands.

## 1. Detect the project type and environment

Check these files in order and stop at the first decisive signal. Record what you found — the report must name the project type, the package manager or toolchain, and the interpreter/runtime used.

**Node / TypeScript**
- `package.json` — read `scripts`, `engines`, `workspaces`.
- Lockfile decides the package manager:

  | Lockfile             | Package manager |
  | -------------------- | --------------- |
  | `pnpm-lock.yaml`     | pnpm            |
  | `package-lock.json`  | npm             |
  | `yarn.lock`          | yarn            |
  | `bun.lockb`          | bun             |

- `.nvmrc` / `.tool-versions` — expected Node version; compare with `node -v` and report a mismatch (do not switch versions yourself).
- `node_modules/` — if missing, install once with the detected package manager and say so in the report.

**Python**
- `pyproject.toml` — build backend (`[build-system]` → uv/poetry/hatch/pdm/setuptools), `[project.scripts]`, and tool configs `[tool.pytest.ini_options]`, `[tool.ruff]`, `[tool.mypy]`, `[tool.coverage]`.
- Lockfile: `uv.lock` → uv, `poetry.lock` → poetry, `pdm.lock` → pdm. `Pipfile` → pipenv.
- `.python-version` — expected interpreter version.
- Virtualenv: `.venv/` first, then `venv/` — an existing `bin/python` (or `Scripts/python.exe` on Windows) inside is the environment to use.
- `.env` files are not needed for verification; never create them.

**Rust**
- `Cargo.toml` — workspace vs single package; `Cargo.lock` present.
- `.cargo/config.toml` — toolchain or target overrides.

**Go**
- `go.mod` — module and Go version; `go.work` marks a workspace.
- `.go-version` — expected Go version.

**Cross-cutting (check for every project type)**
- `Makefile` / `justfile` / `Rakefile` — task-runner targets are the project's canonical commands (`make test`, `just check`, ...).
- `docker-compose.yml` — services the checks may require (databases, brokers).
- CI configuration (`.github/workflows/`, `.gitlab-ci.yml`, ...) — **the CI steps are the project's authoritative verify recipe**: when CI runs a check, run the same one.

## 2. Pick the environment

- **Python**: always run through the project's virtualenv when one exists — invoke its binaries directly (`.venv/bin/pytest`, `.venv/bin/python -m pytest`, ...); no `source .../activate` needed. If no venv exists and `uv` is available, use `uv run <cmd>`. Never assume the system Python. The report states which interpreter and which venv were used.
- **Node**: run scripts through the detected package manager (`pnpm run ...`). Report a Node version mismatch instead of switching.
- **Rust / Go**: the toolchain on `PATH` is the environment; report the version used.

## 3. Run the checks

Order: typecheck → lint → tests (skip steps the project does not configure). Stop at the first failing step; do not run later steps after a failure. Keep the last ~30 relevant lines of each run's output.

**Node** (package manager from the lockfile):
```
pnpm run typecheck     # or tsc --noEmit when the script is missing
pnpm run lint          # or the configured eslint/biome command
pnpm run test          # or vitest run / jest when the script is missing
```

**Python** (via the venv binaries, or `uv run` without a venv):
```
.venv/bin/python -m pytest          # or the [tool.pytest.ini_options] entry
.venv/bin/python -m ruff check .   # only when [tool.ruff] is configured
.venv/bin/python -m mypy .         # only when [tool.mypy] is configured
```

**Rust**:
```
cargo clippy --all-targets
cargo test
```

**Go**:
```
go vet ./...
go test ./...
```

**Task runners**: when a `Makefile`/`justfile`/CI defines the check targets, prefer them over the per-language commands above.

External services: start only what the project's checks demonstrably need (e.g. `docker compose up -d <service>`), and say so in the report.

## 4. Report

1. Environment summary: project type, package manager/toolchain, interpreter/venv, runtime versions.
2. Per-step table: step — pass/fail/skipped — one-line summary.
3. For failures: the key error lines (file, line, message) — not the whole log.
4. State explicitly that nothing was modified by the verification.

## Safety

- Run only the project's check commands (typecheck, lint, test, vet, clippy) and the installs/starts described above.
- Never run destructive, network-mutating, or production commands (migrations, deploys, pushes, `git reset`).
- Do not edit any file. Do not create `.env` files or change dependencies beyond installing the project's own declared dependencies.
