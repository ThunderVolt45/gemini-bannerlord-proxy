# antigravity-bannerlord-proxy

A tiny local HTTP server that lets the **[AI Influence](https://www.nexusmods.com/mountandblade2bannerlord/mods/9711) mod** for *Mount & Blade II: Bannerlord* talk to Google **Antigravity CLI (`agy`)** through an Ollama-compatible API.

The proxy impersonates an [Ollama](https://ollama.com/) server on `localhost:11434`. The mod thinks it is talking to a local Llama-style model; under the hood each request is forwarded to `agy --print` and the response is returned in Ollama's wire format.

---

## Requirements

- **Windows** (tested on Windows 11)
- **[Node.js](https://nodejs.org/) 20+**
- **Antigravity CLI (`agy`)** installed, on PATH, and logged in
- A Google account usable by Antigravity
- **Mount & Blade II: Bannerlord** with the **[AI Influence](https://www.nexusmods.com/mountandblade2bannerlord/mods/9711)** mod installed and enabled

---

## Setup

```powershell
git clone https://github.com/kubilaiswf/gemini-bannerlord-proxy.git
cd gemini-bannerlord-proxy
npm install
```

Double-click **`start.bat`** or run:

```powershell
npm start
```

You should see:

```text
=====================================================
 Antigravity -> Ollama proxy for Bannerlord AIInfluence
=====================================================
 Listening on  http://127.0.0.1:11434
 Antigravity   C:\Users\...\agy.exe
 AGY prompt    file (...)
```

### Configure the mod

In Bannerlord -> **Options -> Mod Options -> AI Influence -> API Settings**:

| Field          | Value                              |
|----------------|------------------------------------|
| AI Provider    | `Ollama`                           |
| Ollama API URL | `http://localhost:11434` (default) |
| Ollama Model   | `gemini-flash:latest`              |

Useful model tags:

| Model tag               | Antigravity model       | Use case                  |
|-------------------------|-------------------------|---------------------------|
| `gemini-flash:latest`   | `gemini-3.5-flash`      | Default / fast responses  |
| `gemini-flash-3:latest` | `gemini-3.5-flash`      | Compatibility alias       |
| `gemini-pro:latest`     | `gemini-3-pro`          | Slower roleplay-heavy use |

The model name from MCM is only a routing string. The proxy maps names containing `pro`, `flash-3`/`flash3`, or `flash` to the model IDs above. Set `FORCE_MODEL` or `AGY_MODEL` to pin a model.

---

## Configuration

Set these in `start.bat` before `node server.js`, or in your shell before `npm start`.

| Variable               | Default       | What it does                                                              |
|------------------------|---------------|---------------------------------------------------------------------------|
| `PORT`                 | `11434`       | TCP port to listen on                                                     |
| `HOST`                 | `127.0.0.1`   | Bind address                                                              |
| `FORCE_MODEL`          | (unset)       | Always use this model or alias, ignoring the mod's requested model        |
| `AGY_MODEL`            | (unset)       | Optional Antigravity model override; unset uses routing or AGY default    |
| `AGY_CMD`              | (auto-detect) | Override the path to `agy.exe`                                            |
| `AGY_TIMEOUT_MS`       | `120000`      | Hard timeout for a single AGY call                                        |
| `AGY_PRINT_TIMEOUT`    | `120s`        | Timeout value passed to `agy --print-timeout`                             |
| `AGY_PROMPT_MODE`      | `file`        | `file` writes the full prompt to a temp file; `inline` passes it as an arg |
| `AGY_PROMPT_DIR`       | OS temp dir   | Root directory for per-request prompt files                               |
| `AGY_SKIP_PERMISSIONS` | `0`           | Set `1` to pass `--dangerously-skip-permissions` to `agy`                 |

---

## How It Works

```text
Bannerlord AI Influence
        |
        | POST /api/chat or /api/generate
        v
This Express proxy on :11434
        |
        | node-pty
        v
Antigravity CLI: agy --print
```

Antigravity prints model output to the terminal/TTY rather than to a normal Node `stdout` pipe, so the proxy runs it through `node-pty` and captures the pseudo-terminal output.

By default, the proxy avoids Windows command-line length limits by writing the full AI Influence prompt to a per-request `prompt.txt` in a temporary folder. `agy --print` receives only a short instruction to read that file and return the final in-character response. The temp folder is removed after the request finishes.

Implemented Ollama endpoints:

- `GET /api/version`
- `GET /api/tags`
- `POST /api/show`
- `POST /api/chat`
- `POST /api/generate`

Streaming requests are returned as a single response chunk followed by a final `done` chunk.

---

## Testing

Run a short end-to-end smoke test:

```powershell
npm run smoke:agy -- "Reply with exactly OK."
```

Test PTY capture behavior directly:

```powershell
$env:AGY_TEST_METHOD="pty"
npm run test:agy -- "Reply with exactly OK."
```

---

## Caveats

- **Permissions.** File prompt mode may require AGY to read the temporary prompt file. If it stalls on a permission prompt, trust the prompt directory in AGY or set `AGY_SKIP_PERMISSIONS=1` after considering the risk.
- **Latency.** `agy --print` starts an AGY run for each request. Expect noticeably higher latency than a direct API call.
- **Agent behavior.** AGY is an agent surface, not a pure text-completion API. The proxy prompts it to avoid file edits, shell commands, artifacts, and process explanations, but real game prompts should still be tested.
- **Parallel requests.** Each incoming request starts its own AGY process. If the mod sends many requests at once, they may compete for CPU, AGY quota, or permissions.

---

## License

MIT — see [LICENSE](LICENSE).

Not affiliated with Google, TaleWorlds, or the AI Influence mod author.
