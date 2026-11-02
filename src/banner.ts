// The banner atop Interactive Mode's profile list: "cswitch" in figlet's
// Standard font, one ANSI color per row so it reads as a gradient. Basic ANSI
// colors only, like the rest of the screen (spec §10.2), so any terminal that
// shows the profile dots shows this too.
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

export const BANNER_ART = [
  "                      _  _          _",
  "  ___  ___ __      __(_)| |_   ___ | |__",
  " / __|/ __|\\ \\ /\\ / /| || __| / __|| '_ \\",
  "| (__ \\__ \\ \\ V  V / | || |_ | (__ | | | |",
  " \\___||___/  \\_/\\_/  |_| \\__| \\___||_| |_|",
];

// Magenta → blue → cyan, top to bottom.
const ROW_COLORS = ["\x1b[35m", "\x1b[95m", "\x1b[94m", "\x1b[34m", "\x1b[36m"];

export const BANNER_TAGLINE = "stop logging out: each folder runs its own Claude account";

/** The banner's lines, already indented to the screen's two-space margin. */
export function renderBanner(): string[] {
  const art = BANNER_ART.map((line, i) => `  ${ROW_COLORS[i]}${line}${RESET}`);
  return [...art, `  ${DIM}${BANNER_TAGLINE}${RESET}`];
}
