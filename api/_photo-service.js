import { randomUUID } from "node:crypto";
import fs from "node:fs";

import OpenAI from "openai";
import sharp from "sharp";

import { log } from "../server/logger.js";

export const targetWidth = 945;
export const targetHeight = 1417;
export const targetDensity = 600;
export const generationSize = "1024x1536";

const apiBaseUrl = process.env.SHOPAIKEY_BASE_URL || "https://direct.shopaikey.com/v1";
const fallbackApiBaseUrl = process.env.SHOPAIKEY_FALLBACK_BASE_URL || "https://api.shopaikey.com/v1";
const imageModel = process.env.SHOPAIKEY_IMAGE_MODEL || "gpt-image-2-all";
const imageRequestTimeoutMs = Number(process.env.SHOPAIKEY_IMAGE_TIMEOUT_MS || 360000);

const studioPrompt = `
Create exactly one professional Vietnamese ID photo from the uploaded reference images of the same person.
Use all uploaded images as references for the same person's identity, face shape, age, skin tone, hairstyle, and natural expression.
Do not create multiple output photos, a collage, a contact sheet, or a multi-person image.
Choose the best consistent facial identity from the references and produce one clean official portrait.
Use a pure white background, realistic studio lighting, sharp facial details, and a polished professional ID photo look.
Frame as a vertical 4x6 cm ID photo: head and upper shoulders visible, centered face, straight posture, natural proportions.
Do not add text, borders, watermark, extra people, props, hats, sunglasses, or decorative background.
Final image should be suitable for official ID/passport-style printing.
`.trim();

export function getPublicConfig() {
  return {
    model: imageModel,
    baseUrl: apiBaseUrl.replace(/^https?:\/\//, ""),
    fallbackBaseUrl: fallbackApiBaseUrl.replace(/^https?:\/\//, ""),
    generationSize,
    uploadMode: "client_compressed_multipart",
    resultMode: "inline_data_url",
    target: {
      label: "4x6 cm",
      width: targetWidth,
      height: targetHeight,
      dpi: targetDensity,
    },
    outputMode: "reference_set_to_single_photo",
  };
}

function ensureConfig() {
  if (!process.env.SHOPAIKEY_API_KEY) {
    const error = new Error("Missing SHOPAIKEY_API_KEY in Vercel Environment Variables.");
    error.statusCode = 500;
    throw error;
  }
}

function getApiBaseUrls() {
  return [...new Set([apiBaseUrl, fallbackApiBaseUrl].filter(Boolean))];
}

function getClient(baseURL) {
  ensureConfig();
  return new OpenAI({
    apiKey: process.env.SHOPAIKEY_API_KEY,
    baseURL,
    maxRetries: 0,
    timeout: imageRequestTimeoutMs,
  });
}

async function imageResponseToBuffer(item) {
  if (item?.b64_json) {
    return Buffer.from(item.b64_json, "base64");
  }

  if (item?.url) {
    const response = await fetch(item.url);
    if (!response.ok) {
      throw new Error(`Could not download generated image URL: HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  throw new Error("The image API did not return b64_json or url.");
}

async function normalizeImage(buffer, outputFormat) {
  const pipeline = sharp(buffer)
    .resize(targetWidth, targetHeight, {
      fit: "cover",
      position: "center",
      withoutEnlargement: false,
    })
    .withMetadata({ density: targetDensity });

  if (outputFormat === "jpg" || outputFormat === "jpeg") {
    return pipeline.jpeg({ quality: 94, mozjpeg: true }).toBuffer();
  }

  return pipeline.png({ compressionLevel: 9 }).toBuffer();
}

function safeBaseName(fileName) {
  return (
    fileName
      .replace(/\.[^.]+$/, "")
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 42) || "photo-id"
  );
}

async function editImageSetWithFallback(files, stepContext) {
  const baseUrls = getApiBaseUrls();
  let lastError = null;
  let retries = 0;

  for (let index = 0; index < baseUrls.length; index += 1) {
    const baseURL = baseUrls[index];
    const endpointLabel = baseURL.replace(/^https?:\/\//, "");

    log("STEP", `Trying ShopAIKey endpoint ${endpointLabel} with ${files.length} input image(s)`, {
      ...stepContext,
      step: `image_edit_attempt_${index + 1}`,
      style: "step",
    });

    const streams = files.map((file) => fs.createReadStream(file.filepath));
    try {
      const client = getClient(baseURL);
      return {
        response: await client.images.edit({
          model: imageModel,
          image: streams,
          prompt: studioPrompt,
          size: generationSize,
          quality: "high",
          output_format: "png",
        }),
        retries,
      };
    } catch (error) {
      lastError = error;
      if (index < baseUrls.length - 1) {
        retries += 1;
        log("WARN", `${error.message}. Switching to fallback endpoint.`, {
          ...stepContext,
          step: "image_edit_retry",
          style: "warning",
        });
      }
    } finally {
      streams.forEach((stream) => stream.destroy());
    }
  }

  const detail = lastError?.message ? ` Last error: ${lastError.message}` : "";
  throw new Error(`Could not connect to ShopAIKey after ${baseUrls.length} endpoint attempt(s).${detail}`);
}

export async function processPhotoProduct(files, outputFormat, workerId) {
  const jobId = randomUUID();
  const stepContext = {
    workerId,
    profileId: jobId,
  };

  log("STEP", `Sending ${files.length} reference image(s) to create one ID photo`, {
    ...stepContext,
    step: "send_reference_set",
    style: "step",
  });

  const { response, retries } = await editImageSetWithFallback(files, stepContext);

  log("STEP", "Normalizing result to 945x1417 px at 600 DPI", {
    ...stepContext,
    step: "normalize_4x6",
    style: "step",
  });

  const generatedBuffer = await imageResponseToBuffer(response.data?.[0]);
  const normalizedBuffer = await normalizeImage(generatedBuffer, outputFormat);
  const extension = outputFormat === "jpg" || outputFormat === "jpeg" ? "jpg" : "png";
  const mimeType = extension === "jpg" ? "image/jpeg" : "image/png";
  const originalName = files[0]?.originalFilename || "photo-id";
  const fileName = `${safeBaseName(originalName)}-id-photo-${Date.now()}.${extension}`;
  const dataUrl = `data:${mimeType};base64,${normalizedBuffer.toString("base64")}`;

  log("OK", `Generated inline result ${fileName} (${normalizedBuffer.length} bytes)`, {
    ...stepContext,
    step: "return_result",
    style: "success",
  });

  return {
    jobId,
    retries,
    result: {
      id: `${jobId}-result`,
      originalName: `${files.length} anh tham chieu`,
      sourceCount: files.length,
      fileName,
      jobId,
      url: dataUrl,
      width: targetWidth,
      height: targetHeight,
      dpi: targetDensity,
      format: extension,
      bytes: normalizedBuffer.length,
    },
  };
}
