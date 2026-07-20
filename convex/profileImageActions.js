import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;

function detectedImageContentType(bytes) {
  if (
    bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff
  ) return "image/jpeg";
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return "image/png";
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) return "image/webp";
  return null;
}

async function readBlobHeader(blob, byteCount) {
  const reader = blob.stream().getReader();
  const header = new Uint8Array(byteCount);
  let bytesRead = 0;
  let streamComplete = false;

  try {
    while (bytesRead < byteCount) {
      const result = await reader.read();
      if (result.done) {
        streamComplete = true;
        break;
      }

      const chunk = result.value;
      const bytesToCopy = Math.min(chunk.byteLength, byteCount - bytesRead);
      header.set(chunk.subarray(0, bytesToCopy), bytesRead);
      bytesRead += bytesToCopy;
    }
  } finally {
    if (!streamComplete) await reader.cancel();
  }

  return header.subarray(0, bytesRead);
}

export const updateProfileImage = action({
  args: { storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not authenticated");
    }
    const image = await ctx.storage.get(args.storageId);
    if (image === null) {
      throw new Error("Uploaded image was not found");
    }
    if (image.size > MAX_PROFILE_IMAGE_BYTES) {
      await ctx.storage.delete(args.storageId);
      throw new Error("Profile pictures must be 5 MB or smaller");
    }

    const header = await readBlobHeader(image, 12);
    const detectedContentType = detectedImageContentType(header);
    const declaredContentType = image.type.split(";", 1)[0].toLowerCase();
    if (
      detectedContentType === null
      || (declaredContentType !== "" && declaredContentType !== detectedContentType)
    ) {
      await ctx.storage.delete(args.storageId);
      throw new Error("Choose a JPEG, PNG, or WebP image");
    }

    await ctx.runMutation(internal.users.commitProfileImage, {
      storageId: args.storageId,
      userId,
    });
    return null;
  },
});
