import { EventEmitter } from "node:events";
import { describe, expect, it, vi, afterEach } from "vitest";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn }));

import { startLocalProcess } from "./local-process.js";

function childFixture() {
  const child = Object.assign(new EventEmitter(), {
    stdin: Object.assign(new EventEmitter(), {
      destroyed: false,
      write: vi.fn(),
    }),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });

  spawn.mockReturnValue(child);

  return child;
}

afterEach(() => {
  vi.useRealTimers();

  vi.clearAllMocks();
});

describe("procesos locales sin shell", () => {
  it("manda q para terminar captura y no usa shell", async () => {
    const child = childFixture();
    const process = startLocalProcess("ffmpeg", ["literal;argument"], {
      timeoutMs: 100,
    });

    process.stop();

    child.emit("close", 0);

    await process.done;

    expect(child.stdin.write).toHaveBeenCalledWith("q\n");

    expect(spawn).toHaveBeenCalledWith(
      "ffmpeg",
      ["literal;argument"],
      expect.objectContaining({ shell: false }),
    );
  });

  it("clasifica permisos de micrófono y no imprime stderr privado", async () => {
    const child = childFixture();
    const process = startLocalProcess("ffmpeg", [], { timeoutMs: 100 });
    const rejection = expect(process.done).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });

    child.stderr.emit("data", "not authorized private-audio");

    child.emit("close", 1);

    await rejection;
  });

  it("clasifica ejecutable ausente", async () => {
    const child = childFixture();
    const process = startLocalProcess("missing", [], { timeoutMs: 100 });
    const rejection = expect(process.done).rejects.toMatchObject({
      code: "DEPENDENCY_MISSING",
    });

    child.emit(
      "error",
      Object.assign(new Error("private"), { code: "ENOENT" }),
    );

    await rejection;
  });

  it("mata el proceso al cancelar y espera su cierre", async () => {
    const child = childFixture();
    const controller = new AbortController();
    const process = startLocalProcess("ffmpeg", [], {
      timeoutMs: 100,
      signal: controller.signal,
    });
    const rejection = expect(process.done).rejects.toMatchObject({
      code: "CANCELLED",
    });

    controller.abort();

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.emit("close", 1);

    await rejection;
  });

  it("timeout escala a SIGKILL y da error controlado", async () => {
    vi.useFakeTimers();

    const child = childFixture();
    const process = startLocalProcess("whisper-cli", [], { timeoutMs: 100 });
    const rejection = expect(process.done).rejects.toMatchObject({
      code: "TIMEOUT",
    });

    await vi.advanceTimersByTimeAsync(1100);

    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    child.emit("close", 1);

    await rejection;
  });
});
