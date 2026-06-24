import { exec, execFile, execSync, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const prompt = process.argv.slice(2).join(" ") || "Reply with exactly OK.";
const timeoutMs = Number(process.env.AGY_TEST_TIMEOUT_MS || 90_000);
const method = process.env.AGY_TEST_METHOD || "all";

function quote(value) {
  return JSON.stringify(value);
}

function show(label, result) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(result, null, 2));
}

async function maybeRun(name, fn) {
  if (method !== "all" && method !== name) return;
  await fn();
}

function runExec(command) {
  return new Promise((resolve) => {
    exec(command, { encoding: "utf8", timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({
        command,
        error: error ? error.message : null,
        code: error?.code ?? 0,
        signal: error?.signal ?? null,
        stdout,
        stderr,
      });
    });
  });
}

function runExecFile(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: "utf8", timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({
        file,
        args,
        error: error ? error.message : null,
        code: error?.code ?? 0,
        signal: error?.signal ?? null,
        stdout,
        stderr,
      });
    });
  });
}

function runSpawn(file, args, stdio = ["ignore", "pipe", "pipe"]) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio });
    let stdout = "";
    let stderr = "";
    const chunks = [];
    const startedAt = Date.now();
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      chunks.push({ stream: "stdout", text });
    });

    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      chunks.push({ stream: "stderr", text });
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        file,
        args,
        error: error.message,
        stdout,
        stderr,
        chunks,
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        file,
        args,
        code,
        signal,
        elapsedMs: Date.now() - startedAt,
        stdout,
        stderr,
        chunks,
      });
    });
  });
}

function runExecSync(command) {
  try {
    return {
      command,
      stdout: execSync(command, { encoding: "utf8", timeout: timeoutMs }),
      stderr: "",
      error: null,
    };
  } catch (error) {
    return {
      command,
      error: error.message,
      code: error.status ?? null,
      signal: error.signal ?? null,
      stdout: error.stdout?.toString() ?? "",
      stderr: error.stderr?.toString() ?? "",
    };
  }
}

async function resolveAgyPath() {
  if (process.env.AGY_CMD) return process.env.AGY_CMD;
  if (os.platform() === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "agy", "bin", "agy.exe");
  }
  return "agy";
}

async function runPty(file, args) {
  const pty = await import("node-pty");
  return new Promise((resolve) => {
    let output = "";
    const startedAt = Date.now();
    const term = pty.spawn(file, args, {
      name: "xterm-256color",
      cols: 200,
      rows: 60,
      cwd: process.cwd(),
      env: {
        ...process.env,
        NO_COLOR: "1",
        TERM: "dumb",
      },
    });

    const timer = setTimeout(() => {
      try { term.kill(); } catch {}
      resolve({
        file,
        args,
        timedOut: true,
        elapsedMs: Date.now() - startedAt,
        output,
      });
    }, timeoutMs);

    term.onData((data) => {
      output += data;
      console.log("pty chunk:", JSON.stringify(data));
    });

    term.onExit((event) => {
      clearTimeout(timer);
      resolve({
        file,
        args,
        exitCode: event.exitCode,
        signal: event.signal,
        elapsedMs: Date.now() - startedAt,
        output,
      });
    });
  });
}

async function runPtyStdin(file, args, input) {
  const pty = await import("node-pty");
  return new Promise((resolve) => {
    let output = "";
    const startedAt = Date.now();
    const term = pty.spawn(file, args, {
      name: "xterm-256color",
      cols: 200,
      rows: 60,
      cwd: process.cwd(),
      env: {
        ...process.env,
        NO_COLOR: "1",
        TERM: "dumb",
      },
    });

    const timer = setTimeout(() => {
      try { term.kill(); } catch {}
      resolve({
        file,
        args,
        timedOut: true,
        elapsedMs: Date.now() - startedAt,
        output,
      });
    }, timeoutMs);

    term.onData((data) => {
      output += data;
      console.log("pty stdin chunk:", JSON.stringify(data));
    });

    term.onExit((event) => {
      clearTimeout(timer);
      resolve({
        file,
        args,
        exitCode: event.exitCode,
        signal: event.signal,
        elapsedMs: Date.now() - startedAt,
        output,
      });
    });

    setTimeout(() => {
      term.write(input.replace(/\n/g, "\r\n"));
      term.write("\r");
    }, 500);
  });
}

console.log("Antigravity CLI capture test");
console.log(`Prompt: ${prompt}`);
console.log(`Timeout: ${timeoutMs}ms`);
console.log(`Method: ${method}`);
console.log(`TTY: stdin=${process.stdin.isTTY}, stdout=${process.stdout.isTTY}, stderr=${process.stderr.isTTY}`);

const printArgs = ["--print", prompt, "--print-timeout=60s"];
const printCommand = `agy --print ${quote(prompt)} --print-timeout=60s`;
const agyPath = await resolveAgyPath();

await maybeRun("version", async () => {
  show("exec: agy --version", await runExec("agy --version"));
  show("execFile: agy --version", await runExecFile("agy", ["--version"]));
});

await maybeRun("exec", async () => {
  show("exec: agy --print", await runExec(printCommand));
});

await maybeRun("execFile", async () => {
  show("execFile: agy --print", await runExecFile("agy", printArgs));
});

await maybeRun("spawn", async () => {
  show("spawn pipe: agy --print", await runSpawn("agy", printArgs));
});

await maybeRun("spawn-inherit", async () => {
  show("spawn inherit: agy --print", await runSpawn("agy", printArgs, ["ignore", "inherit", "inherit"]));
});

await maybeRun("pty", async () => {
  show("node-pty: agy --print", await runPty(agyPath, printArgs));
});

await maybeRun("pty-stdin", async () => {
  if (process.env.AGY_TEST_ALLOW_STDIN !== "1") {
    show("node-pty stdin: agy --print", {
      skipped: true,
      reason: "This mode can be interpreted by agy as an interactive task and may edit the workspace. Set AGY_TEST_ALLOW_STDIN=1 to run it.",
    });
    return;
  }
  show("node-pty stdin: agy --print", await runPtyStdin(agyPath, ["--print", "--print-timeout=60s"], prompt));
});

await maybeRun("pty-stdin-dash", async () => {
  if (process.env.AGY_TEST_ALLOW_STDIN !== "1") {
    show("node-pty stdin: agy --print -", {
      skipped: true,
      reason: "This mode can be interpreted by agy as an interactive task and may edit the workspace. Set AGY_TEST_ALLOW_STDIN=1 to run it.",
    });
    return;
  }
  show("node-pty stdin: agy --print -", await runPtyStdin(agyPath, ["--print", "-", "--print-timeout=60s"], prompt));
});

await maybeRun("execSync", async () => {
  show("execSync: agy --print", runExecSync(printCommand));
});

console.log("\nDone.");
