import { spawn } from "node:child_process";

const port = Number(process.env.TEST_PORT || 11435);
const prompt = process.argv.slice(2).join(" ") || "Reply with exactly OK.";
const timeoutMs = Number(process.env.TEST_TIMEOUT_MS || 120_000);
let serverOutput = "";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(child) {
  const startedAt = Date.now();
  let exited = false;
  let exitCode = null;

  child.on("exit", (code) => {
    exited = true;
    exitCode = code;
  });

  while (Date.now() - startedAt < timeoutMs) {
    if (exited) {
      throw new Error(`server exited early with code ${exitCode}\n${serverOutput}`);
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/version`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch {
      // Keep polling until timeout; the server may still be binding.
    }

    await delay(500);
  }

  throw new Error(`server did not answer /api/version within ${timeoutMs}ms\n${serverOutput}`);
}

async function postGenerate() {
  const response = await fetch(`http://127.0.0.1:${port}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.TEST_MODEL || "gemini-flash:latest",
      prompt,
      stream: false,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`non-JSON response ${response.status}: ${text}`);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

const child = spawn(process.execPath, ["server.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

const onServerData = (chunk) => {
  const text = chunk.toString();
  serverOutput += text;
  process.stdout.write(text);
};
child.stdout.on("data", onServerData);
child.stderr.on("data", onServerData);

try {
  await waitForServer(child);
  const result = await postGenerate();
  console.log("\n=== /api/generate response ===");
  console.log(JSON.stringify(result, null, 2));
  if (!String(result.response || "").trim()) {
    throw new Error("proxy returned an empty response");
  }
  console.log("\nSmoke test passed.");
} finally {
  child.kill("SIGTERM");
}
