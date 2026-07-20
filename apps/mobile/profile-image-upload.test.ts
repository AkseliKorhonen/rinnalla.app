import { describe, expect, test, vi } from "vitest";
import {
  MAX_PROFILE_IMAGE_BYTES,
  profileImageContentType,
  uploadProfileImageFile,
} from "./profile-image-upload";

function createFile(overrides: Partial<{
  exists: boolean;
  size: number;
  status: number;
  body: string;
}> = {}) {
  const upload = vi.fn(async () => ({
    body: overrides.body ?? JSON.stringify({ storageId: "storage-1" }),
    headers: {},
    status: overrides.status ?? 200,
  }));
  return {
    file: {
      exists: overrides.exists ?? true,
      size: overrides.size ?? 1_024,
      upload,
    },
    upload,
  };
}

describe("profile image upload", () => {
  test("normalizes JPEG aliases", () => {
    expect(profileImageContentType("image/jpg")).toBe("image/jpeg");
    expect(profileImageContentType(undefined)).toBe("image/jpeg");
  });

  test("uploads the native file directly and commits its storage ID", async () => {
    const { file, upload } = createFile();
    const generateUploadUrl = vi.fn(async () => "https://upload.example");
    const updateProfileImage = vi.fn(async () => undefined);

    await uploadProfileImageFile({
      asset: { fileSize: 1_024, mimeType: "image/png" },
      file,
      generateUploadUrl,
      updateProfileImage,
      uploadType: 0,
    });

    expect(upload).toHaveBeenCalledWith("https://upload.example", {
      headers: { "Content-Type": "image/png" },
      httpMethod: "POST",
      uploadType: 0,
    });
    expect(updateProfileImage).toHaveBeenCalledWith({ storageId: "storage-1" });
  });

  test("rejects unsupported formats before requesting an upload URL", async () => {
    const { file } = createFile();
    const generateUploadUrl = vi.fn(async () => "https://upload.example");

    await expect(uploadProfileImageFile({
      asset: { mimeType: "image/gif" },
      file,
      generateUploadUrl,
      updateProfileImage: vi.fn(async () => undefined),
      uploadType: 0,
    })).rejects.toThrow("Choose a JPEG, PNG, or WebP image.");
    expect(generateUploadUrl).not.toHaveBeenCalled();
  });

  test("checks the native file size when picker metadata is absent", async () => {
    const { file } = createFile({ size: MAX_PROFILE_IMAGE_BYTES + 1 });

    await expect(uploadProfileImageFile({
      asset: { mimeType: "image/jpeg" },
      file,
      generateUploadUrl: vi.fn(async () => "https://upload.example"),
      updateProfileImage: vi.fn(async () => undefined),
      uploadType: 0,
    })).rejects.toThrow("Profile pictures must be 5 MB or smaller.");
  });
});
