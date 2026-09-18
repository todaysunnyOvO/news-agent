import { spawn } from "node:child_process";

export interface ProcessOptions {
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  truncated: boolean;
}

function createSafeProcessEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NO_COLOR: "1" };
  const pathValue = process.env.PATH ?? process.env.Path;
  if (pathValue) {
    environment.PATH = pathValue;
    environment.Path = pathValue;
  }
  for (const name of ["PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP"] as const) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return environment;
}

export function runProcess(
  executable: string,
  args: string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason ?? new Error("Process aborted"));
      return;
    }

    const startedAt = performance.now();
    const child = spawn(executable, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: createSafeProcessEnvironment(),
    });

    let stdout = "";
    let stderr = "";
    let capturedBytes = 0;
    let truncated = false;
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
      const remaining = Math.max(0, options.maxOutputBytes - capturedBytes);
      if (remaining === 0) {
        truncated = true;
        return;
      }

      const accepted = chunk.subarray(0, remaining);
      const text = accepted.toString("utf8");
      if (target === "stdout") stdout += text;
      else stderr += text;
      capturedBytes += accepted.byteLength;
      if (accepted.byteLength < chunk.byteLength) truncated = true;
    };

    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));

    const terminate = (): void => {
      if (!child.killed) child.kill();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs);
    const onAbort = (): void => {
      aborted = true;
      terminate();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const cleanup = (): void => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    };

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });

    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (timedOut) {
        reject(new Error(`Command timed out after ${options.timeoutMs} ms`));
        return;
      }
      if (aborted) {
        reject(options.signal?.reason ?? new Error("Process aborted"));
        return;
      }

      resolve({
        stdout,
        stderr,
        exitCode: code ?? -1,
        durationMs: Math.round(performance.now() - startedAt),
        truncated,
      });
    });
  });
}
