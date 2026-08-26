/** Executable PTY child scenarios kept as parsed source instead of eval strings. */

import { realDelay } from "../waiting.ts";

const scenario = Deno.args[0];

switch (scenario) {
  case "slow-raw": {
    await realDelay("pty-child-slow-start", 2_500);
    Deno.stdin.setRaw(true);
    try {
      console.log("fresh sibling ready");
      const input = new Uint8Array(1);
      const read = await Deno.stdin.read(input);
      console.log(`observed:${read === null ? "eof" : input[0]}`);
    } finally {
      Deno.stdin.setRaw(false);
    }
    break;
  }
  case "raw-three-byte": {
    Deno.stdin.setRaw(true);
    try {
      console.log("unrelated input reader ready");
      const input = new Uint8Array(3);
      let offset = 0;
      while (offset < input.length) {
        const read = await Deno.stdin.read(input.subarray(offset));
        if (read === null) break;
        offset += read;
      }
      console.log(`observed:${[...input.subarray(0, offset)].join(",")}`);
    } finally {
      Deno.stdin.setRaw(false);
    }
    break;
  }
  case "hanging": {
    const pidPath = Deno.args[1];
    if (pidPath === undefined) throw new Error("hanging PTY child needs a PID path");
    await Deno.writeTextFile(pidPath, String(Deno.pid));
    console.log("timeout child ready");
    await Deno.stdin.read(new Uint8Array(1));
    break;
  }
  case "progressing-raw": {
    Deno.stdin.setRaw(true);
    try {
      console.log("progress phase one");
      await Deno.stdin.read(new Uint8Array(1));
      await realDelay("pty-child-progress-phase-one", 900);
      console.log("progress phase two");
      await Deno.stdin.read(new Uint8Array(1));
      await realDelay("pty-child-progress-phase-two", 900);
      console.log("progress complete");
    } finally {
      Deno.stdin.setRaw(false);
    }
    break;
  }
  case "multi-write-frame": {
    Deno.stdin.setRaw(true);
    try {
      console.log("frame begins");
      await realDelay("pty-child-frame-middle", 350);
      console.log("frame middle");
      await realDelay("pty-child-frame-completion", 350);
      console.log("frame complete");
      await Deno.stdin.read(new Uint8Array(1));
    } finally {
      Deno.stdin.setRaw(false);
    }
    break;
  }
  case "held-input": {
    Deno.stdin.setRaw(true);
    try {
      console.log("unrelated reader ready");
      await Deno.stdin.read(new Uint8Array(1));
      const second = new Uint8Array(1);
      const state = await Promise.race([
        Deno.stdin.read(second).then((read) => read === null ? "eof" : "data"),
        realDelay("pty-child-held-input-window", 250).then(() => "open"),
      ]);
      console.log(`input-state:${state}`);
      Deno.exit(0);
    } finally {
      Deno.stdin.setRaw(false);
    }
    break;
  }
  case "shell-reporting":
    console.log(`command-shell:${Deno.env.get("SHELL")}`);
    break;
  default:
    throw new Error(`unknown PTY child scenario: ${scenario}`);
}
