/** The IO seam init (and later interactive commands) go through, so tests can fake stdin/stdout. */
export interface Io {
  write(text: string): void;
  isTTY: boolean;
  question(prompt: string): Promise<string>;
}

export function createProcessIo(): Io {
  return {
    write: (text) => {
      process.stdout.write(text);
    },
    isTTY: process.stdin.isTTY === true && process.stdout.isTTY === true,
    async question(prompt) {
      const readline = await import("node:readline/promises");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(prompt);
      } finally {
        rl.close();
      }
    },
  };
}
