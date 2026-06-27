# antigravity-bannerlord-proxy

## 한국어 README

Mount & Blade II: Bannerlord의 **[AI Influence](https://www.nexusmods.com/mountandblade2bannerlord/mods/9711)** 모드가 Google **Antigravity CLI (`agy`)**와 통신할 수 있도록 도와주는 작은 로컬 HTTP 프록시입니다.

이 프록시는 `localhost:11434`에서 [Ollama](https://ollama.com/) 호환 API처럼 동작합니다. AI Influence 모드는 로컬 Ollama 모델과 대화한다고 생각하지만, 실제로는 요청이 `agy --print`로 전달되고 응답은 Ollama 형식으로 다시 반환됩니다.

---

## 요구 사항

- **Windows** (Windows 11에서 테스트)
- **[Node.js](https://nodejs.org/) 20+**
- **Antigravity CLI (`agy`)** 설치, PATH 등록, 로그인 완료
- Antigravity에서 사용할 수 있는 Google 계정
- **Mount & Blade II: Bannerlord**
- **[AI Influence](https://www.nexusmods.com/mountandblade2bannerlord/mods/9711)** 모드 설치 및 활성화

---

## 설치

```powershell
git clone https://github.com/ThunderVolt45/gemini-bannerlord-proxy.git
cd gemini-bannerlord-proxy
npm install
```

실행은 `start.bat`을 더블 클릭하거나 아래 명령을 사용합니다.

```powershell
npm start
```

정상 실행되면 대략 다음과 같은 로그가 보입니다.

```text
=====================================================
 Antigravity -> Ollama proxy for Bannerlord AIInfluence
=====================================================
 Listening on  http://127.0.0.1:11434
 Antigravity   C:\Users\...\agy.exe
 AGY prompt    file (...)
 AGY PTY reuse enabled
```

---

## AI Influence 설정

Bannerlord에서 **Options -> Mod Options -> AI Influence -> API Settings**로 이동한 뒤 다음처럼 설정합니다.

| 항목 | 값 |
|---|---|
| AI Provider | `Ollama` |
| Ollama API URL | `http://localhost:11434` |
| Ollama Model | `gemini-flash:latest` |

사용할 수 있는 모델 태그는 다음과 같습니다.

| 모델 태그 | Antigravity 모델 | 용도 |
|---|---|---|
| `gemini-flash:latest` | `gemini-3.5-flash` | 기본값 / 빠른 응답 |
| `gemini-flash-3:latest` | `gemini-3.5-flash` | 호환용 alias |
| `gemini-pro:latest` | `gemini-3-pro` | 더 무거운 RP 응답 |

MCM에 입력하는 모델명은 라우팅용 문자열입니다. 프록시는 모델명에 `pro`, `flash-3`/`flash3`, `flash`가 포함되어 있는지 보고 실제 Antigravity 모델로 매핑합니다. 항상 특정 모델을 쓰고 싶다면 `FORCE_MODEL` 또는 `AGY_MODEL`을 설정하세요.

---

## 환경 변수

`start.bat`에서 `node server.js` 실행 전에 설정하거나, `npm start`를 실행하는 셸에서 설정할 수 있습니다.

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `11434` | 프록시가 listen할 TCP 포트 |
| `HOST` | `127.0.0.1` | 바인드 주소 |
| `FORCE_MODEL` | 미설정 | 모드가 요청한 모델명을 무시하고 항상 사용할 모델 또는 alias |
| `AGY_MODEL` | 미설정 | Antigravity 모델 override. 미설정 시 요청 모델 라우팅 또는 AGY 기본값 사용 |
| `AGY_CMD` | 자동 탐지 | `agy.exe` 경로를 직접 지정 |
| `AGY_TIMEOUT_MS` | `120000` | 단일 AGY 호출의 hard timeout |
| `AGY_PRINT_TIMEOUT` | `120s` | `agy --print-timeout`에 전달할 값 |
| `AGY_PROMPT_MODE` | `file` | `file`은 전체 프롬프트를 임시 파일에 저장, `inline`은 인자로 직접 전달 |
| `AGY_PROMPT_DIR` | OS 임시 폴더 | 요청별 `prompt.txt`를 만들 루트 폴더 |
| `AGY_SKIP_PERMISSIONS` | `0` | `1`이면 `--dangerously-skip-permissions` 전달 |
| `AGY_REUSE_WINDOWS_PTY` | `1` | Windows에서 하나의 PTY를 재사용해 프록시 계층의 콘솔 생성 횟수를 줄임 |

---

## 동작 방식

```text
Bannerlord AI Influence
        |
        | POST /api/chat 또는 /api/generate
        v
이 Express 프록시 (:11434)
        |
        | node-pty
        v
Antigravity CLI: agy --print
```

Antigravity는 일반 Node `stdout` pipe로는 모델 출력을 제대로 전달하지 않고 터미널/TTY에 출력하는 경우가 있어서, 이 프록시는 `node-pty`를 사용해 `agy --print`를 실행하고 pseudo-terminal 출력을 캡처합니다.

기본값인 `AGY_PROMPT_MODE=file`에서는 Windows 명령줄 길이 제한을 피하기 위해 전체 AI Influence 프롬프트를 요청별 임시 폴더의 `prompt.txt`에 저장합니다. `agy --print`에는 해당 파일을 읽고 최종 in-character 응답만 출력하라는 짧은 지시문만 전달합니다. 요청이 끝나면 임시 폴더는 삭제됩니다.

Windows에서는 기본적으로 `AGY_REUSE_WINDOWS_PTY=1`이 적용됩니다. 이 경우 프록시는 요청마다 새 PTY를 만들지 않고, 하나의 백그라운드 PTY 안에서 요청별 배치 래퍼를 순차 실행합니다. 이 방식은 프록시 계층에서 생기는 콘솔 호스트 churn을 줄이지만, AGY 자체가 내부적으로 자식 프로세스나 콘솔 호스트를 생성하는 동작까지 막지는 못합니다.

구현된 Ollama 호환 엔드포인트:

- `GET /api/version`
- `GET /api/tags`
- `POST /api/show`
- `POST /api/chat`
- `POST /api/generate`

스트리밍 요청은 전체 응답 1개 chunk와 마지막 `done` chunk를 반환하는 방식으로 처리됩니다.

---

## 테스트

짧은 end-to-end smoke test:

```powershell
npm run smoke:agy -- "Reply with exactly OK."
```

PTY 캡처 동작 직접 테스트:

```powershell
$env:AGY_TEST_METHOD="pty"
npm run test:agy -- "Reply with exactly OK."
```

---

## 주의 사항

- **포커스 문제.** `AGY_REUSE_WINDOWS_PTY=1`은 프록시가 요청마다 새 PTY를 만드는 문제를 줄이는 완화책입니다. 하지만 `agy.exe` 자체가 내부 자식 프로세스나 콘솔 호스트를 띄우면 Windows 포커스가 순간적으로 풀릴 수 있습니다.
- **권한 프롬프트.** 파일 프롬프트 모드에서는 AGY가 임시 `prompt.txt`를 읽을 권한이 필요할 수 있습니다. 권한 확인에서 멈춘다면 해당 임시 폴더를 신뢰하거나, 위험을 이해한 뒤 `AGY_SKIP_PERMISSIONS=1`을 사용할 수 있습니다.
- **지연 시간.** 각 요청은 AGY 실행을 거치므로 직접 API 호출보다 느릴 수 있습니다.
- **Agent 특성.** AGY는 순수 text completion API가 아니라 agent surface입니다. 프록시는 파일 수정, shell 실행, artifact 생성, 과정 설명을 피하도록 지시하지만 실제 게임 프롬프트에서는 충분한 테스트가 필요합니다.
- **병렬 요청.** Windows에서 PTY 재사용이 켜져 있으면 요청은 하나씩 queue되어 실행됩니다. 다른 모드에서는 요청마다 AGY 프로세스가 생길 수 있어 CPU, quota, 권한 프롬프트가 서로 영향을 줄 수 있습니다.

---

## 라이선스

MIT - [LICENSE](LICENSE)를 참고하세요.

Google, TaleWorlds, AI Influence 모드 제작자와는 관련이 없는 비공식 프로젝트입니다.

---

# English README

A tiny local HTTP proxy that lets the **[AI Influence](https://www.nexusmods.com/mountandblade2bannerlord/mods/9711)** mod for Mount & Blade II: Bannerlord talk to Google **Antigravity CLI (`agy`)**.

The proxy impersonates an [Ollama](https://ollama.com/) server on `localhost:11434`. The mod thinks it is talking to a local Ollama model, while each request is forwarded to `agy --print` and returned in Ollama-compatible wire format.

---

## Requirements

- **Windows** (tested on Windows 11)
- **[Node.js](https://nodejs.org/) 20+**
- **Antigravity CLI (`agy`)** installed, available on PATH, and logged in
- A Google account usable by Antigravity
- **Mount & Blade II: Bannerlord**
- **[AI Influence](https://www.nexusmods.com/mountandblade2bannerlord/mods/9711)** installed and enabled

---

## Setup

```powershell
git clone https://github.com/ThunderVolt45/gemini-bannerlord-proxy.git
cd gemini-bannerlord-proxy
npm install
```

Double-click `start.bat`, or run:

```powershell
npm start
```

You should see output similar to:

```text
=====================================================
 Antigravity -> Ollama proxy for Bannerlord AIInfluence
=====================================================
 Listening on  http://127.0.0.1:11434
 Antigravity   C:\Users\...\agy.exe
 AGY prompt    file (...)
 AGY PTY reuse enabled
```

---

## AI Influence Configuration

In Bannerlord, open **Options -> Mod Options -> AI Influence -> API Settings** and set:

| Field | Value |
|---|---|
| AI Provider | `Ollama` |
| Ollama API URL | `http://localhost:11434` |
| Ollama Model | `gemini-flash:latest` |

Available model tags:

| Model tag | Antigravity model | Use case |
|---|---|---|
| `gemini-flash:latest` | `gemini-3.5-flash` | Default / fast responses |
| `gemini-flash-3:latest` | `gemini-3.5-flash` | Compatibility alias |
| `gemini-pro:latest` | `gemini-3-pro` | Heavier roleplay responses |

The model name in MCM is only a routing string. The proxy maps names containing `pro`, `flash-3`/`flash3`, or `flash` to the Antigravity model IDs above. Set `FORCE_MODEL` or `AGY_MODEL` to pin a model.

---

## Environment Variables

Set these in `start.bat` before `node server.js`, or in the shell before running `npm start`.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `11434` | TCP port to listen on |
| `HOST` | `127.0.0.1` | Bind address |
| `FORCE_MODEL` | unset | Always use this model or alias, ignoring the mod's requested model |
| `AGY_MODEL` | unset | Optional Antigravity model override; unset uses routing or AGY default |
| `AGY_CMD` | auto-detect | Override the path to `agy.exe` |
| `AGY_TIMEOUT_MS` | `120000` | Hard timeout for a single AGY call |
| `AGY_PRINT_TIMEOUT` | `120s` | Value passed to `agy --print-timeout` |
| `AGY_PROMPT_MODE` | `file` | `file` writes the full prompt to a temp file; `inline` passes it as an argument |
| `AGY_PROMPT_DIR` | OS temp dir | Root directory for per-request `prompt.txt` files |
| `AGY_SKIP_PERMISSIONS` | `0` | Set `1` to pass `--dangerously-skip-permissions` |
| `AGY_REUSE_WINDOWS_PTY` | `1` | Reuse one Windows PTY to reduce console host churn in the proxy layer |

---

## How It Works

```text
Bannerlord AI Influence
        |
        | POST /api/chat or /api/generate
        v
This Express proxy (:11434)
        |
        | node-pty
        v
Antigravity CLI: agy --print
```

Antigravity can write model output to a terminal/TTY instead of a normal Node `stdout` pipe, so the proxy runs `agy --print` through `node-pty` and captures pseudo-terminal output.

By default, `AGY_PROMPT_MODE=file` avoids Windows command-line length limits by writing the full AI Influence prompt to a per-request `prompt.txt` file. `agy --print` receives only a short instruction to read that file and return the final in-character response. The temporary request folder is removed after the request completes.

On Windows, `AGY_REUSE_WINDOWS_PTY=1` is enabled by default. Instead of creating a fresh PTY per request, the proxy keeps one background PTY alive and runs each request through a per-request batch wrapper. This reduces console host churn from the proxy layer, but it cannot stop AGY itself from spawning child processes or console hosts.

Implemented Ollama-compatible endpoints:

- `GET /api/version`
- `GET /api/tags`
- `POST /api/show`
- `POST /api/chat`
- `POST /api/generate`

Streaming requests are returned as one response chunk followed by a final `done` chunk.

---

## Testing

Short end-to-end smoke test:

```powershell
npm run smoke:agy -- "Reply with exactly OK."
```

Direct PTY capture test:

```powershell
$env:AGY_TEST_METHOD="pty"
npm run test:agy -- "Reply with exactly OK."
```

---

## Caveats

- **Focus stealing.** `AGY_REUSE_WINDOWS_PTY=1` reduces the proxy's per-request PTY creation, but `agy.exe` may still spawn child processes or console hosts that briefly steal focus on Windows.
- **Permissions.** File prompt mode may require AGY to read the temporary `prompt.txt` file. If it stalls on a permission prompt, trust the temporary directory or set `AGY_SKIP_PERMISSIONS=1` after considering the risk.
- **Latency.** Each request goes through AGY, so expect higher latency than a direct API call.
- **Agent behavior.** AGY is an agent surface, not a pure text-completion API. The proxy asks it to avoid file edits, shell commands, artifacts, and process explanations, but real game prompts should still be tested.
- **Parallel requests.** With PTY reuse enabled on Windows, requests are queued and run one at a time. Other modes may start one AGY process per request, so CPU, quota, or permission prompts can still compete.

---

## License

MIT - see [LICENSE](LICENSE).

Not affiliated with Google, TaleWorlds, or the AI Influence mod author.
