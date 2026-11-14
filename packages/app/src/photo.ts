/**
 * A photo from the phone's camera, made small enough to send with a question: scaled so that
 * its longer side is at most MAX_SIDE and saved as JPEG. A price tag stays readable at that
 * size, and the upload is a few hundred kilobytes instead of several megabytes.
 */
import type { ChatImage } from "@mydata/shared";

const MAX_SIDE = 1280;
const QUALITY = 0.8;

export interface PreparedPhoto {
  /** What goes to the coach. */
  image: ChatImage;
  /** The same picture as a data URL, for the chat bubble. */
  url: string;
}

export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("That picture could not be opened. Try taking the photo again.");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot prepare the photo.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const url = canvas.toDataURL("image/jpeg", QUALITY);
  return { image: { mimeType: "image/jpeg", data: url.slice(url.indexOf(",") + 1) }, url };
}
