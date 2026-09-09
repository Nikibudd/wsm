import { jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchLatestRelease, downloadAsset, canSelfUpdate, installUpdate } from "../src/update.js";

describe("update", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("fetchLatestRelease", () => {
    test("parses the version and wsm.mjs asset URL from GitHub's latest-release API response", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: "v1.2.0",
          assets: [
            { name: "wsm.mjs", browser_download_url: "https://example.com/wsm.mjs" },
            { name: "other-file", browser_download_url: "https://example.com/other" },
          ],
        }),
      }) as unknown as typeof fetch;

      const release = await fetchLatestRelease("Nikibudd/wsm");
      expect(release).toEqual({ version: "1.2.0", downloadUrl: "https://example.com/wsm.mjs" });
    });

    test("throws a clear error when the GitHub API request fails", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      }) as unknown as typeof fetch;

      await expect(fetchLatestRelease("Nikibudd/wsm")).rejects.toThrow(/404/);
    });

    test("throws a clear error when the latest release has no wsm.mjs asset", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ tag_name: "v1.2.0", assets: [] }),
      }) as unknown as typeof fetch;

      await expect(fetchLatestRelease("Nikibudd/wsm")).rejects.toThrow(/wsm\.mjs/);
    });
  });

  describe("downloadAsset", () => {
    test("returns the downloaded bytes as a Buffer", async () => {
      const bytes = new TextEncoder().encode("fake binary content").buffer;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => bytes,
      }) as unknown as typeof fetch;

      const buf = await downloadAsset("https://example.com/wsm.mjs");
      expect(buf.toString()).toBe("fake binary content");
    });

    test("throws a clear error when the download fails", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Server Error",
      }) as unknown as typeof fetch;

      await expect(downloadAsset("https://example.com/wsm.mjs")).rejects.toThrow(/500/);
    });
  });

  describe("canSelfUpdate", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wsm-update-test-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("allows updating a real file named exactly 'wsm'", () => {
      const target = path.join(tmpDir, "wsm");
      fs.writeFileSync(target, "content");
      expect(canSelfUpdate(target)).toEqual({ ok: true });
    });

    test("refuses when invoked as anything other than exactly 'wsm' (e.g. wsmdev)", () => {
      const target = path.join(tmpDir, "wsmdev");
      fs.writeFileSync(target, "content");
      expect(canSelfUpdate(target).ok).toBe(false);
    });

    test("refuses when the 'wsm'-named path is a symlink (looks like a dev install via npm link)", () => {
      const realFile = path.join(tmpDir, "real-target.js");
      fs.writeFileSync(realFile, "content");
      const target = path.join(tmpDir, "wsm");
      fs.symlinkSync(realFile, target);
      expect(canSelfUpdate(target).ok).toBe(false);
    });

    test("refuses when there's no known path at all", () => {
      expect(canSelfUpdate(undefined).ok).toBe(false);
    });
  });

  describe("installUpdate", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wsm-update-test-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("atomically replaces the target file's contents and makes it executable", () => {
      const target = path.join(tmpDir, "wsm");
      fs.writeFileSync(target, "old content");

      installUpdate(target, Buffer.from("new content"));

      expect(fs.readFileSync(target, "utf8")).toBe("new content");
      const mode = fs.statSync(target).mode;
      expect(mode & 0o111).toBeTruthy();
    });

    test("doesn't leave a stray temp file behind in the target directory", () => {
      const target = path.join(tmpDir, "wsm");
      fs.writeFileSync(target, "old content");

      installUpdate(target, Buffer.from("new content"));

      expect(fs.readdirSync(tmpDir)).toEqual(["wsm"]);
    });
  });
});
