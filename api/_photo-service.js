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
const defaultImageModel = "gpt-image-2";
const imageModel = process.env.SHOPAIKEY_IMAGE_MODEL === "gpt-image-2-all" ? defaultImageModel : process.env.SHOPAIKEY_IMAGE_MODEL || defaultImageModel;
const fallbackImageModel =
  process.env.SHOPAIKEY_FALLBACK_IMAGE_MODEL === "gpt-image-2-all"
    ? defaultImageModel
    : process.env.SHOPAIKEY_FALLBACK_IMAGE_MODEL || defaultImageModel;
const imageRequestTimeoutMs = Number(process.env.SHOPAIKEY_IMAGE_TIMEOUT_MS || 290000);

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
    fallbackModel: fallbackImageModel,
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

export function getImageModels() {
  return [...new Set([imageModel, fallbackImageModel].filter(Boolean))];
}

function getClient(baseURL, timeout = imageRequestTimeoutMs) {
  ensureConfig();
  return new OpenAI({
    apiKey: process.env.SHOPAIKEY_API_KEY,
    baseURL,
    maxRetries: 0,
    timeout,
  });
}

function isTimeoutError(error) {
  return /timeout|timed out|aborted/i.test(`${error?.name || ""} ${error?.message || ""}`);
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

async function editImageSetWithFallback(files, stepContext, models = [imageModel]) {
  const baseUrls = getApiBaseUrls();
  const startedAt = Date.now();
  let lastError = null;
  let retries = 0;

  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex];

    for (let urlIndex = 0; urlIndex < baseUrls.length; urlIndex += 1) {
      const remainingMs = imageRequestTimeoutMs - (Date.now() - startedAt);
      if (remainingMs <= 1000) {
        const error = new Error(`Qua ${Math.round(imageRequestTimeoutMs / 1000)} giay nhung model chua tra ket qua.`);
        error.statusCode = 504;
        throw error;
      }

      const baseURL = baseUrls[urlIndex];
      const endpointLabel = baseURL.replace(/^https?:\/\//, "");
      const attempt = modelIndex * baseUrls.length + urlIndex + 1;
      const hasNextAttempt = modelIndex < models.length - 1 || urlIndex < baseUrls.length - 1;

      log("STEP", `Trying model ${model} at ShopAIKey endpoint ${endpointLabel} with ${files.length} input image(s)`, {
        ...stepContext,
        step: `image_edit_attempt_${attempt}`,
        style: "step",
      });

      const streams = files.map((file) => fs.createReadStream(file.filepath));
      try {
        const client = getClient(baseURL, remainingMs);
        return {
          response: await client.images.edit({
            model,
            image: streams,
            prompt: studioPrompt,
            size: generationSize,
            quality: "high",
            output_format: "png",
          }),
          model,
          retries,
        };
      } catch (error) {
        lastError = error;
        if (isTimeoutError(error)) {
          error.statusCode = 504;
        }

        if (hasNextAttempt && !isTimeoutError(error)) {
          retries += 1;
          log("WARN", `${error.message}. Switching to fallback endpoint/model.`, {
            ...stepContext,
            step: "image_edit_retry",
            style: "warning",
          });
        }

        if (isTimeoutError(error)) {
          break;
        }
      } finally {
        streams.forEach((stream) => stream.destroy());
      }
    }
  }

  const detail = lastError?.message ? ` Last error: ${lastError.message}` : "";
  throw new Error(`Could not connect to ShopAIKey after ${models.length} model and ${baseUrls.length} endpoint attempt(s).${detail}`);
}

export async function processPhotoProduct(files, outputFormat, workerId, requestedModel = imageModel) {
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

  const { response, retries, model } = await editImageSetWithFallback(files, stepContext, [requestedModel]);

  log("STEP", `Normalizing result from model ${model} to 945x1417 px at 600 DPI`, {
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
      model,
    },
  };
}
