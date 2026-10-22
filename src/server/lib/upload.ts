import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { badRequest } from "./errors.ts";
import { logger } from "./logger.ts";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
} as const;

type Ext = keyof typeof TYPES;

export const UPLOAD_NAME = /^[0-9a-f-]{36}\.(png|jpg|webp)$/;

/** Identifies an image by its magic bytes rather than its claimed type. */
export function sniffImage(bytes: Uint8Array): Ext | null {
  const at = (i: number, ...seq: number[]) =>
    seq.every((b, j) => bytes[i + j] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (at(0, 0xff, 0xd8, 0xff)) return "jpg";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) {
    return "webp";
  }
  return null;
}

export function contentTypeFor(name: string): string {
  const ext = name.split(".").pop() as Ext;
  return TYPES[ext] ?? "application/octet-stream";
}

/** Validates and stores an uploaded image, returning its new file name. */
export async function saveImage(dir: string, file: File): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw badRequest("That image is too large. Please use one under 5 MB.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = sniffImage(bytes);
  if (!ext) {
    throw badRequest("Please upload a PNG, JPEG or WebP image.");
  }
  await mkdir(dir, { recursive: true });
  const name = `${crypto.randomUUID()}.${ext}`;
  await Bun.write(join(dir, name), bytes);
  return name;
}

export async function removeImage(dir: string, name: string | null) {
  if (!name || !UPLOAD_NAME.test(name)) return;
  try {
    await unlink(join(dir, name));
  } catch (err) {
    logger.warn("could not remove image", { name, err });
  }
}
