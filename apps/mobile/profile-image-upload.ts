import type { UploadOptions, UploadResult } from "expo-file-system";

export const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
export const PROFILE_IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type ProfileImageAsset = {
  fileSize?: number;
  mimeType?: string | null;
};

type UploadableFile = {
  exists: boolean;
  size: number;
  upload: (url: string, options: UploadOptions) => Promise<UploadResult>;
};

export function profileImageContentType(
  mimeType: string | null | undefined,
) {
  if (mimeType === "image/jpg") return "image/jpeg";
  return mimeType ?? "image/jpeg";
}

export async function uploadProfileImageFile<StorageId extends string>({
  asset,
  file,
  generateUploadUrl,
  updateProfileImage,
  uploadType,
}: {
  asset: ProfileImageAsset;
  file: UploadableFile;
  generateUploadUrl: () => Promise<string>;
  updateProfileImage: (args: { storageId: StorageId }) => Promise<unknown>;
  uploadType: NonNullable<UploadOptions["uploadType"]>;
}) {
  const contentType = profileImageContentType(asset.mimeType);
  if (!PROFILE_IMAGE_CONTENT_TYPES.has(contentType)) {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  if (
    asset.fileSize !== undefined &&
    asset.fileSize > MAX_PROFILE_IMAGE_BYTES
  ) {
    throw new Error("Profile pictures must be 5 MB or smaller.");
  }
  if (!file.exists) throw new Error("Could not read the selected picture.");
  if (file.size > MAX_PROFILE_IMAGE_BYTES) {
    throw new Error("Profile pictures must be 5 MB or smaller.");
  }

  const uploadUrl = await generateUploadUrl();
  const uploadResponse = await file.upload(uploadUrl, {
    headers: { "Content-Type": contentType },
    httpMethod: "POST",
    uploadType,
  });
  if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
    throw new Error("Could not upload your picture.");
  }

  const upload = JSON.parse(uploadResponse.body) as { storageId?: StorageId };
  if (!upload.storageId) throw new Error("The upload did not return a file ID.");
  await updateProfileImage({ storageId: upload.storageId });
}
