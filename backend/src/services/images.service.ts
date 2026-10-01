import { log } from "node:console";
import fs from "node:fs";
import path from "node:path";

const dataDir = process.env.DATA_DIR ?? "./data";
const IMAGE_DIR = path.join(dataDir, "images");

export class ImagesService {

  static ensureDir() {
    if (!fs.existsSync(IMAGE_DIR)) {
      fs.mkdirSync(IMAGE_DIR, { recursive: true });
    }
  }

  /**
   * Absolute path of an image, creating the directory first so a caller that
   * writes the file itself — ffmpeg, in poster.ts — has somewhere to put it.
   */
  static pathFor(filename: string): string {
    ImagesService.ensureDir();

    return path.join(IMAGE_DIR, filename);
  }

  /**
   * The public path of a stored image with its modification time attached,
   * or null when the file is not there.
   *
   * A replaced avatar or poster keeps its name — every row already points at
   * it — so without the `?v=` a browser holding the old picture under that
   * URL has no reason to fetch it again. The static route ignores the query.
   */
  static urlFor(filename: string): string | null {
    try {
      const { mtimeMs } = fs.statSync(path.join(IMAGE_DIR, filename));

      return `/images/${filename}?v=${Math.floor(mtimeMs)}`;
    } catch {
      return null;
    }
  }

  /**
   * `urlFor` for a stored `/images/...` path, which is how the columns hold
   * them. Anything else — a bundled asset, a path whose file is gone — comes
   * back unchanged.
   */
  static versioned(publicPath: string | null): string | null {
    if (!publicPath?.startsWith("/images/")) return publicPath;

    return ImagesService.urlFor(ImagesService.nameOf(publicPath)) ?? publicPath;
  }

  /** The bare filename behind a public path, query and folders dropped. */
  static nameOf(publicPath: string): string {
    const bare = publicPath.split("?")[0];

    return bare.split("/").pop() ?? bare;
  }

  static exists(filename: string): boolean {
    try {
      return fs.existsSync(path.join(IMAGE_DIR, filename));
    } catch {
      return false;
    }
  }

  /**
   * Duplicates an image already in the store, so a second consumer can own a
   * copy it is free to delete. False when there was nothing to copy.
   */
  static copy(from: string, to: string): boolean {
    try {
      ImagesService.ensureDir();

      const source = path.join(IMAGE_DIR, from);

      if (!fs.existsSync(source)) return false;

      fs.copyFileSync(source, path.join(IMAGE_DIR, to));

      return true;
    } catch (e) {
      console.error("Image copy error:", e);
      return false;
    }
  }

  static async download(url: string, filename: string): Promise<string | null> {
    try {
      ImagesService.ensureDir();

      const res = await fetch(url);
      if (!res.ok) return null;

      const buffer = Buffer.from(await res.arrayBuffer());

      const filePath = path.join(IMAGE_DIR, filename);

      fs.writeFileSync(filePath, buffer);

      return `/images/${filename}`;
    } catch (e) {
      console.error("Image download error:", e);
      return null;
    }
  }

  static async remove(filename: string) {
    const sanitizedFilename = ImagesService.nameOf(filename);

    try {
      const filePath = path.join(IMAGE_DIR, sanitizedFilename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {
      console.error("Image delete error:", e);
    }
  }
}