import express from "express";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import pty from "node-pty";

const PORT = Number(process.env.PORT || 11434);
const HOST = process.env.HOST || "127.0.0.1";
const REQUEST_TIMEOUT_MS = Number(process.env.AGY_TIMEOUT_MS || 120_000);
const AGY_PRINT_TIMEOUT = process.env.AGY_PRINT_TIMEOUT || `${Math.ceil(REQUEST_TIMEOUT_MS / 1000)}s`;
const AGY_PROMPT_MODE = (process.env.AGY_PROMPT_MODE || "file").toLowerCase();
const AGY_PROMPT_DIR = process.env.AGY_PROMPT_DIR || os.tmpdir();
const AGY_SKIP_PERMISSIONS = process.env.AGY_SKIP_PERMISSIONS === "1";

const MODEL_ALIASES = {
  flash: "gemini-3.5-flash",
  "flash-3": "gemini-3.5-flash",
  pro: "gemini-3-pro",
};

function resolveAgyLauncher() {
  if (process.env.AGY_CMD && fs.existsSync(process.env.AGY_CMD)) {
    return process.env.AGY_CMD;
  }

  if (os.platform() === "win32") {
    try {
      const where = spawnSync("where", ["agy"], { encoding: "utf8" });
      const line = where.stdout.split(/\r?\n/).find((l) => l.trim().length > 0);
      if (line && fs.existsSync(line.trim())) return line.trim();
    } catch {}

    const localAppData = process.env.LOCALAPPDATA || "";
    const candidate = path.join(localAppData, "agy", "bin", "agy.exe");
    if (fs.existsSync(candidate)) return candidate;
  }

  return "agy";
}

const AGY_LAUNCHER = resolveAgyLauncher();

const ADVERTISED_MODELS = [
  { tag: "gemini-flash:latest", alias: "flash" },
  { tag: "gemini-flash-3:latest", alias: "flash-3" },
  { tag: "gemini-pro:latest", alias: "pro" },
];

const app = express();
app.use(express.json({ limit: "20mb" }));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

function pickModelId(requestedModel) {
  const force = process.env.FORCE_MODEL || process.env.AGY_MODEL;
  if (force) return MODEL_ALIASES[force] || force;
  if (!requestedModel) return "";
  const m = String(requestedModel).toLowerCase();
  if (m.includes("pro")) return MODEL_ALIASES.pro;
  if (m.includes("flash-3") || m.includes("flash3")) return MODEL_ALIASES["flash-3"];
  if (m.includes("flash")) return MODEL_ALIASES.flash;
  if (m.startsWith("gemini-")) return requestedModel;
  return "";
}

function splitMessages(messages) {
  const systemParts = [];
  const convo = [];
  for (const msg of messages || []) {
    if (!msg || typeof msg.content !== "string") continue;
    if (msg.role === "system") {
      systemParts.push(msg.content);
    } else if (msg.role === "user") {
      convo.push(`Human: ${msg.content}`);
    } else if (msg.role === "assistant") {
      convo.push(`Assistant: ${msg.content}`);
    }
  }
  return {
    system: systemParts.join("\n\n").trim(),
    userPrompt: convo.join("\n\n").trim(),
  };
}

const DEFAULT_SYSTEM_PROMPT = "You are roleplaying inside a Mount and Blade: Bannerlord scene. Follow the instructions in the user message and respond directly in character. Do not mention being an AI, an assistant, tools, or coding. Reply only with the in-character text the game expects.";

function stripTerminalControls(text) {
  return String(text || "")
    // ANSI CSI/OSC/control sequences.
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    // Remaining C0 controls except tab/newline/carriage return.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function normalizePtyOutput(output) {
  const cleaned = stripTerminalControls(output)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();

  return cleaned;
}

async function runAgy({ system, prompt, model }) {
  const effectiveSystem = system && system.trim().length > 0 ? system : DEFAULT_SYSTEM_PROMPT;
  const fullPrompt = effectiveSystem + "\n\n---\n\n" + (prompt || "");
  let requestDir = null;
  const args = [];

  if (model) args.push("--model", model);
  if (AGY_SKIP_PERMISSIONS) args.push("--dangerously-skip-permissions");

  if (AGY_PROMPT_MODE === "inline") {
    if (os.platform() === "win32" && fullPrompt.length > 28_000) {
      throw new Error(`agy prompt is ${fullPrompt.length} chars, which is too long for Windows command-line argument mode`);
    }
    args.push("--print", fullPrompt, `--print-timeout=${AGY_PRINT_TIMEOUT}`);
  } else {
    fs.mkdirSync(AGY_PROMPT_DIR, { recursive: true });
    requestDir = fs.mkdtempSync(path.join(AGY_PROMPT_DIR, "agy-bannerlord-"));
    const promptPath = path.join(requestDir, "prompt.txt");
    fs.writeFileSync(promptPath, fullPrompt, "utf8");
    const instruction = [
      "You are servicing a local Mount & Blade II: Bannerlord AI Influence mod request.",
      `Read the complete UTF-8 prompt from this file: ${promptPath}`,
      "Follow the instructions inside that file exactly.",
      "Do not modify files, run shell commands, create artifacts, or explain your process.",
      "Output only the final in-character response text that should be returned to the game.",
    ].join("\n");
    args.push("--add-dir", requestDir, "--print", instruction, `--print-timeout=${AGY_PRINT_TIMEOUT}`);
  }

  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const startedAt = Date.now();
    let child;

    const cleanup = () => {
      if (requestDir) {
        try { fs.rmSync(requestDir, { recursive: true, force: true }); } catch {}
      }
    };

    try {
      child = pty.spawn(AGY_LAUNCHER, args, {
        name: "xterm-256color",
        cols: 240,
        rows: 80,
        cwd: process.cwd(),
        env: {
          ...process.env,
          NO_COLOR: "1",
          TERM: "dumb",
        },
      });
    } catch (err) {
      cleanup();
      reject(err);
      return;
    }

    const settle = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      fn();
    };

    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      settle(() => reject(new Error(`agy CLI timed out after ${REQUEST_TIMEOUT_MS}ms`)));
    }, REQUEST_TIMEOUT_MS);

    child.onData((data) => {
      output += data;
    });

    child.onExit(({ exitCode, signal }) => {
      settle(() => {
        const text = normalizePtyOutput(output);
        if (exitCode !== 0) {
          reject(new Error(`agy exited ${exitCode}${signal ? ` (${signal})` : ""}: ${text || "no output"}`));
          return;
        }
        if (!text) {
          reject(new Error("agy exited successfully but produced no PTY output"));
          return;
        }
        console.log(`  ~~ agy pty captured ${output.length} raw chars -> ${text.length} text chars in ${Date.now() - startedAt}ms`);
        resolve({ text, raw: { output } });
      });
    });
  });
}

app.get("/", (_req, res) => {
  res.type("text/plain").send("Ollama is running");
});

app.get("/api/version", (_req, res) => {
  res.json({ version: "0.2.0-antigravity-proxy" });
});

app.get("/api/tags", (_req, res) => {
  const now = new Date().toISOString();
  res.json({
    models: ADVERTISED_MODELS.map(({ tag }) => ({
      name: tag,
      model: tag,
      modified_at: now,
      size: 0,
      digest: "sha256:antigravity",
      details: {
        parent_model: "",
        format: "gguf",
        family: "antigravity",
        families: ["antigravity"],
        parameter_size: "N/A",
        quantization_level: "N/A",
      },
    })),
  });
});

app.post("/api/show", (req, res) => {
  const name = req.body?.name || "gemini-flash:latest";
  res.json({
    modelfile: `# Antigravity proxy: ${name}`,
    parameters: "",
    template: "{{ .Prompt }}",
    details: {
      parent_model: "",
      format: "gguf",
      family: "antigravity",
      families: ["antigravity"],
      parameter_size: "N/A",
      quantization_level: "N/A",
    },
  });
});

app.post("/api/chat", async (req, res) => {
  const { model, messages, stream } = req.body || {};
  const providerModel = pickModelId(model);
  const { system, userPrompt } = splitMessages(messages);

  console.log(`  -> /api/chat model=${model} -> ${providerModel || "(agy default)"}, msgs=${messages?.length ?? 0}, stream=${!!stream}, sysLen=${system.length}, promptLen=${userPrompt.length}`);
  const t0 = Date.now();

  try {
    const { text } = await runAgy({ system, prompt: userPrompt, model: providerModel });
    const dt = Date.now() - t0;
    console.log(`  <- /api/chat done in ${dt}ms, replyLen=${text.length}`);
    const now = new Date().toISOString();

    if (stream) {
      res.setHeader("Content-Type", "application/x-ndjson");
      res.write(JSON.stringify({
        model: model || "gemini-flash:latest",
        created_at: now,
        message: { role: "assistant", content: text },
        done: false,
      }) + "\n");
      res.write(JSON.stringify({
        model: model || "gemini-flash:latest",
        created_at: now,
        message: { role: "assistant", content: "" },
        done: true,
        done_reason: "stop",
        total_duration: dt * 1_000_000,
        load_duration: 0,
        prompt_eval_count: 0,
        prompt_eval_duration: 0,
        eval_count: 0,
        eval_duration: dt * 1_000_000,
      }) + "\n");
      res.end();
    } else {
      res.json({
        model: model || "gemini-flash:latest",
        created_at: now,
        message: { role: "assistant", content: text },
        done: true,
        done_reason: "stop",
        total_duration: dt * 1_000_000,
        load_duration: 0,
        prompt_eval_count: 0,
        prompt_eval_duration: 0,
        eval_count: 0,
        eval_duration: dt * 1_000_000,
      });
    }
  } catch (err) {
    console.error("  !! /api/chat error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/generate", async (req, res) => {
  const { model, prompt, system, stream } = req.body || {};
  const providerModel = pickModelId(model);

  console.log(`  -> /api/generate model=${model} -> ${providerModel || "(agy default)"}, stream=${!!stream}, sysLen=${(system||"").length}, promptLen=${(prompt||"").length}`);
  const t0 = Date.now();

  try {
    const { text } = await runAgy({ system: system || "", prompt: prompt || "", model: providerModel });
    const dt = Date.now() - t0;
    console.log(`  <- /api/generate done in ${dt}ms`);
    const now = new Date().toISOString();

    if (stream) {
      res.setHeader("Content-Type", "application/x-ndjson");
      res.write(JSON.stringify({
        model: model || "gemini-flash:latest",
        created_at: now,
        response: text,
        done: false,
      }) + "\n");
      res.write(JSON.stringify({
        model: model || "gemini-flash:latest",
        created_at: now,
        response: "",
        done: true,
        done_reason: "stop",
        total_duration: dt * 1_000_000,
        load_duration: 0,
      }) + "\n");
      res.end();
    } else {
      res.json({
        model: model || "gemini-flash:latest",
        created_at: now,
        response: text,
        done: true,
        done_reason: "stop",
        total_duration: dt * 1_000_000,
        load_duration: 0,
      });
    }
  } catch (err) {
    console.error("  !! /api/generate error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.use((req, res) => {
  console.log(`  ?? unhandled ${req.method} ${req.url}`);
  res.status(404).json({ error: "not found" });
});

app.listen(PORT, HOST, () => {
  console.log("=====================================================");
  console.log(" Antigravity -> Ollama proxy for Bannerlord AIInfluence");
  console.log("=====================================================");
  console.log(` Listening on  http://${HOST}:${PORT}`);
  console.log(` Antigravity   ${AGY_LAUNCHER}`);
  console.log(` AGY model     ${process.env.AGY_MODEL || "(Antigravity default)"}`);
  console.log(` AGY timeout   ${AGY_PRINT_TIMEOUT}`);
  console.log(` AGY prompt    ${AGY_PROMPT_MODE}${AGY_PROMPT_MODE === "file" ? ` (${AGY_PROMPT_DIR})` : ""}`);
  console.log(` AGY perms     ${AGY_SKIP_PERMISSIONS ? "auto-approve" : "default"}`);
  console.log("");
  console.log(" In Bannerlord MCM > AIInfluence:");
  console.log("   Provider     = Ollama");
  console.log(`   API URL      = http://localhost:${PORT}`);
  console.log("   Model        = gemini-flash:latest   (fast, cheapest)");
  console.log("                  gemini-flash-3:latest (balanced)");
  console.log("                  gemini-pro:latest     (smartest, slowest)");
  console.log("");
  console.log(" Logs from each request appear below. Ctrl+C to stop.");
  console.log("-----------------------------------------------------");
});

function shutdown() {
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
