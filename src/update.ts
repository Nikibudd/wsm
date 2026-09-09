import fs from "node:fs";
import path from "node:path";

const REPO = "Nikibudd/wsm";
const ASSET_NAME = "wsm.mjs";

export interface ReleaseAsset {
  version: string;
  downloadUrl: string;
}

interface GithubReleaseResponse {
  tag_name: string;
  assets: { name: string; browser_download_url: string }[];
}

// GitHub's public REST API, unauthenticated — no `gh` CLI or token needed,
// so this works for anyone who downloaded a release, not just contributors.
export async function fetchLatestRelease(repo: string = REPO): Promise<ReleaseAsset> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`);
  if (!res.ok) {
    throw new Error(`Checking for updates failed: GitHub API returned ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as GithubReleaseResponse;
  const asset = data.assets.find((a) => a.name === ASSET_NAME);
  if (!asset) {
    throw new Error(`Latest release (${data.tag_name}) has no ${ASSET_NAME} asset to download`);
  }
  return { version: data.tag_name.replace(/^v/, ""), downloadUrl: asset.browser_download_url };
}

export async function downloadAsset(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// Guards `wsm update` against ever overwriting a `wsmdev` (npm-link)
// install: only a real, non-symlinked file literally named "wsm" qualifies.
// `wsmdev` is always a symlink into this repo's dist/cli.js — writing
// through it would clobber a tracked source file, not "update" anything.
export function canSelfUpdate(targetPath: string | undefined): { ok: true } | { ok: false; reason: string } {
  if (!targetPath) {
    return { ok: false, reason: "Could not determine this binary's own path." };
  }
  const name = path.basename(targetPath);
  if (name !== "wsm") {
    return {
      ok: false,
      reason: `wsm update only works on a real release install, not "${name}" — a development build (wsmdev) updates via npm run build instead.`,
    };
  }
  if (fs.lstatSync(targetPath).isSymbolicLink()) {
    return {
      ok: false,
      reason: `"${targetPath}" is a symlink, not a real release file — this looks like a development install (npm link), which updates via npm run build instead.`,
    };
  }
  return { ok: true };
}

// Writes to a temp file in the SAME directory as the target (guarantees the
// same filesystem, so the final rename is atomic — no risk of a half-
// written binary if the process dies partway through), then renames it
// into place. Also (re-)sets the executable bit: a plain fetch() download
// doesn't preserve file permissions.
export function installUpdate(targetPath: string, data: Buffer): void {
  const dir = path.dirname(targetPath);
  const tmpPath = path.join(dir, `.${path.basename(targetPath)}.update-${process.pid}`);
  fs.writeFileSync(tmpPath, data);
  fs.chmodSync(tmpPath, 0o755);
  fs.renameSync(tmpPath, targetPath);
}
