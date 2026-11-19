import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "assets");

const appFiles = [
  ["generated/jeff-mark.png", "jeff-mark.png"],
  ["generated/jeff-mark-eyeless.png", "jeff-mark-eyeless.png"],
  ["app-icons/jeff-1024.png", "jeff-app-icon.png"],
  ["logo/jeff-logo-horizontal.png", "jeff-logo-horizontal.png"],
  ["generated/favicon-16.png", "favicon-16.png"],
  ["generated/favicon-32.png", "favicon-32.png"],
  ["generated/favicon-48.png", "favicon-48.png"],
  ["generated/favicon-64.png", "favicon-64.png"],
  ["generated/favicon.ico", "favicon.ico"],
  ["generated/apple-touch-icon.png", "apple-touch-icon.png"],
  ["banner/jeff-banner-1500x500.png", "jeff-banner-1500x500.png"],
  ["banner/jeff-og-1200x630.png", "jeff-og-1200x630.png"],
];

const launcherFiles = [
  ["generated/jeff-mark.png", "jeff-mark.png"],
  ["app-icons/jeff-1024.png", "jeff-app-icon.png"],
];

function copy(files, target) {
  mkdirSync(target, { recursive: true });
  for (const [from, to] of files) {
    copyFileSync(resolve(source, from), resolve(target, to));
  }
}

/** Fills the public folder of an app that references brand files by URL. */
export function syncBrand(target) {
  copy(appFiles, target);
}

/** The desktop launcher keeps its brand copies in the repository. */
export function syncLauncherBrand(target) {
  copy(launcherFiles, target);
}
