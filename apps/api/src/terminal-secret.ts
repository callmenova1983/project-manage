import { emitKeypressEvents, type Key } from "node:readline";
import { stdin, stdout } from "node:process";

export class TerminalCancelled extends Error {}
export function assertPrivateTerminal(): void {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function")
    throw new Error(
      "Use an interactive terminal in your own private Codespace. Piped input and redirected output are not accepted.",
    );
}
/** Reads one line without echoing characters, stars, or clipboard content. */
export function hiddenInput(prompt: string): Promise<string> {
  assertPrivateTerminal();
  return new Promise((resolve, reject) => {
    let value = "";
    let settled = false;
    const wasRaw = stdin.isRaw;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      stdin.off("keypress", onKey);
      stdin.off("end", onCancel);
      stdin.off("error", onCancel);
      for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
        process.off(signal, onCancel);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdout.write("\n");
      const result = value;
      value = "";
      if (error) reject(error);
      else resolve(result);
    };
    const onCancel = () =>
      finish(
        new TerminalCancelled("Cancelled. No password reset was submitted."),
      );
    const onKey = (text: string | undefined, key: Key) => {
      if (key.ctrl && ["c", "d"].includes(key.name ?? "")) return onCancel();
      if (key.name === "return" || key.name === "enter") return finish();
      if (key.name === "backspace") {
        value = Array.from(value).slice(0, -1).join("");
        return;
      }
      if (key.ctrl && key.name === "u") {
        value = "";
        return;
      }
      if (
        key.ctrl ||
        key.meta ||
        !text ||
        Array.from(text).some((character) => {
          const code = character.codePointAt(0)!;
          return code < 32 || (code >= 127 && code <= 159);
        })
      )
        return;
      value += text;
      if (value.length > 500)
        finish(
          new TerminalCancelled(
            "Input exceeds 500 characters. Cancelled without changing the account.",
          ),
        );
    };
    // Switch echo off before displaying the prompt or accepting input.
    stdin.setRawMode(true);
    emitKeypressEvents(stdin);
    stdin.on("keypress", onKey);
    stdin.once("end", onCancel);
    stdin.once("error", onCancel);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
      process.once(signal, onCancel);
    stdout.write(prompt);
    stdin.resume();
  });
}
