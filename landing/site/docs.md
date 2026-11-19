# Jeff

> Jeff is a self-hosted AI agent workbench. One or more Jeffs work inside your project with the engine, model, tools and permissions you choose. Open source (Apache-2.0).

- Site: https://ferforastieri.github.io/toph/
- Docs: https://ferforastieri.github.io/toph/docs.html
- Markdown docs: https://ferforastieri.github.io/toph/docs.md
- Source: https://github.com/ferforastieri/toph
- Releases: https://github.com/ferforastieri/toph/releases

## What it does

- One Jeff per task or several Jeffs in a group. Each runs in its own session with shared task history.
- Router picks 0–2 Jeffs for a message; explicit `@handle` mentions win; `todos` calls everyone; a Jeff can delegate or mention another.
- Engines: OpenCode, Claude Code, Codex. Others listed but not wired.
- Models: OpenAI, Anthropic, DeepSeek, OpenRouter, Groq, Mistral, xAI, Ollama or a company gateway.
- Permissions: Plan (read only), Ask (approval before changes), YOLO (allowed tools run without prompting).
- Tools: files, shell, Git, MCP, skills, memory, artifacts, images, audio, questions and approvals.
- Workbench: project explorer/editor, terminal, source control, databases, debug, web apps and previews.
- Files: upload, edit and stream downloads of any size.

## Install (Linux, root)

```bash
# 1. install binary + systemd service
curl -fsSL https://github.com/ferforastieri/toph/releases/latest/download/install.sh | sudo sh -s -- --no-components

# 2. review the generated environment
sudo sed -n '1,120p' /etc/jeff/jeff.env

# 3. start and enable
sudo systemctl enable --now jeff

# 4. verify
curl -fsS http://127.0.0.1:8787/api/health
curl -fsS http://127.0.0.1:8787/api/version
```

Expected minimum configuration:

```env
JEFF_ADDR=0.0.0.0:8787
JEFF_DATA_DIR=/var/lib/jeff
JEFF_WORKSPACES=/srv/jeff/workspaces
JEFF_ADMIN_PASSWORD=<strong-password>
JEFF_SECURE_COOKIES=false
JEFF_TRUSTED_PROXIES=
```

Use `JEFF_SECURE_COOKIES=true` behind HTTPS. Set `JEFF_TRUSTED_PROXIES` to the reverse proxy IP/CIDR. The frontend is at `/app`; login uses the `jeff_session` cookie. Data lives in `JEFF_DATA_DIR/jeff.db`; the master key is `JEFF_DATA_DIR/master.key`. Back up both together.

## Docker

```bash
git clone https://github.com/ferforastieri/toph.git
cd jeff
JEFF_ADMIN_PASSWORD='change-me' docker compose -f deploy/compose.yaml up -d
```

## Requirements

- Linux x86_64/arm64 server (or the desktop app on macOS/Linux/Windows).
- Port 8787 free (or set `JEFF_ADDR`).
- Git; Node/pnpm and Rust only when building from source.
- A model connection (API key, gateway or local Ollama) for the Jeffs.

## First Jeff

1. Settings → Connections: connect a model provider and test it.
2. Use the `+` button: it lists every Git repository under the allowed workspace roots. Pick one; Jeff creates and opens the project if needed.
3. Create a Jeff: choose a profile (Jeff, Leo, Nico, Nova, Bia, Pia, Atlas, Rafa) or start from zero. Set name, handle, role, prompt, model, engine, effort and tools.
4. Choose permissions: Plan, Ask or YOLO.
5. Open a task and write. Mention `@handle`, attach images/files, or record audio. History stays with the task.

## Groups and ordering

- A message without a mention goes through the router; it selects 0–2 Jeffs, or everyone when asked.
- An explicit mention always wins.
- Each selected Jeff runs in its own session with the shared task history.
- A new message while a run is active cancels the previous run, waits for it to end and inserts the new user message after the previous output.

## Tools, MCP and approvals

- File, shell, Git and artifact tools run through the Jeff gateway.
- Settings → Connections → MCPs: configure servers and select which Jeff can use each one. The agent calls `mcp_list` and `mcp_call`.
- Approval modes: Plan (read only), Ask (approval before mutations), YOLO (allowed tools run).
- Skills are reusable recipes; memory stores durable project facts. Both are exposed to the agent.

## Workbench

- Explorer/editor, file upload and streaming download.
- Source control: status, diffs, stage, commit, branches, blame, discard.
- Terminal per project.
- Databases: Postgres, MySQL, SQLite connections, schema and queries.
- Debug: breakpoints, console, variables.
- Web apps and previews with logs.

## Attachments

- Drag and drop images or use the attach button.
- Up to 6 attachments and 8 MB total per message; the run endpoint accepts a 32 MB body.
- OpenCode receives images as real `--file` attachments.
- Audio can be transcribed by the browser; otherwise it is attached as a file.

## Update

- Settings → Harness: update OpenCode (`opencode upgrade`), Claude Code (`claude update`) or Codex (`npm install -g @openai/codex@latest`).
- OpenCode must be 2.2.6 or newer; older versions lose MCP tools on the first turn.
- Re-run the installer to update the Jeff binary; the app also exposes releases.
- Hard refresh (`Ctrl+Shift+R`) after a frontend update.

## Troubleshooting

- Agent shows only `skill` / no tools: update OpenCode to 2.2.6+.
- `mcp_list` 401: the MCP token expired; update it in Connections.
- `mcp_list` “not selected”: the server name/id does not belong to that Jeff; use the exact name from the prompt.
- Image send does nothing: update the app, hard refresh, keep attachments under 8 MB total; the route accepts 32 MB.
- Download “not available”: ensure the reverse proxy forwards `/api/projects/*/raw` and does not buffer the stream. Jeff streams any size.
- 401 behind HTTPS: set `JEFF_SECURE_COOKIES=true` and `JEFF_TRUSTED_PROXIES`.
- Port busy: `ss -ltnp | grep 8787`, then change `JEFF_ADDR`.

## For AI agents

Goal: install and verify Jeff on a Linux server.

```bash
# 1. install
curl -fsSL https://github.com/ferforastieri/toph/releases/latest/download/install.sh | sudo sh -s -- --no-components

# 2. configure
sudo sed -n '1,120p' /etc/jeff/jeff.env
# edit JEFF_ADDR, JEFF_WORKSPACES, JEFF_ADMIN_PASSWORD, JEFF_SECURE_COOKIES

# 3. start
sudo systemctl enable --now jeff

# 4. verify
curl -fsS http://127.0.0.1:8787/api/health
curl -fsS http://127.0.0.1:8787/api/version
```

Rules:

- Do not invent paths; use the values above or the ones already present in `/etc/jeff/jeff.env`.
- Do not print or commit secrets. `JEFF_ADMIN_PASSWORD`, API keys and `master.key` are secret.
- Back up `JEFF_DATA_DIR/jeff.db` and `JEFF_DATA_DIR/master.key` together.
- If a command fails, show the exact output and stop; do not fake a successful install.
- After install, report the URL, version, data directory and where the database and master key live.
