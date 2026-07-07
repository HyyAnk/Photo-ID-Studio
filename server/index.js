import "dotenv/config";

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import multer from "multer";
import OpenAI from "openai";
import sharp from "sharp";

import { log } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const uploadDir = path.join(projectRoot, "uploads");
const resultDir = path.join(projectRoot, "result");
const distDir = path.join(projectRoot, "dist");

const targetWidth = 945;
const targetHeight = 1417;
const targetDensity = 600;
const generationSize = "1024x1536";
const apiBaseUrl = process.env.SHOPAIKEY_BASE_URL || "https://direct.shopaikey.com/v1";
const fallbackApiBaseUrl = process.env.SHOPAIKEY_FALLBACK_BASE_URL || "https://api.shopaikey.com/v1";
const imageModel = process.env.SHOPAIKEY_IMAGE_MODEL || "gpt-image-2-all";
const imageRequestTimeoutMs = Number(process.env.SHOPAIKEY_IMAGE_TIMEOUT_MS || 360000);
const port = Number(process.env.PORT || 3001);

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(resultDir, { recursive: true });

const app = express();
const upload = multer({
  dest: uploadDir,
  limits: {
    files: 4,
    fileSize: 12 * 1024 * 1024,
  },
  fileFilter: (request, file, callback) => {
    if (!file.mimetype.startsWith("image/")) {
      callback(new Error("Chi nhan file anh."));
      return;
    }
    callback(null, true);
  },
});

app.use(express.json());
app.use("/result", express.static(resultDir));
app.use(express.static(distDir));

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

function ensureConfig() {
  if (!process.env.SHOPAIKEY_API_KEY) {
    const error = new Error("Thieu SHOPAIKEY_API_KEY trong .env.");
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
      throw new Error(`Khong tai duoc anh ket qua tu URL tam: HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  throw new Error("API khong tra ve b64_json hoac url cho anh ket qua.");
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
    return pipeline.jpeg({ quality: 96, mozjpeg: true }).toBuffer();
  }

  return pipeline.png({ compressionLevel: 9 }).toBuffer();
}

function publicResultPath(jobId, fileName) {
  return `/result/${jobId}/${fileName}`;
}

function safeBaseName(fileName) {
  return (
    path
      .parse(fileName)
      .name.replace(/[^\p{L}\p{N}_-]+/gu, "-")
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

    log("STEP", `Thu ShopAIKey endpoint ${endpointLabel} voi ${files.length} anh input`, {
      ...stepContext,
      step: `image_edit_attempt_${index + 1}`,
      style: "step",
    });

    const streams = files.map((file) => fs.createReadStream(file.path));
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
        log("WARN", `${error.message}. Chuyen sang endpoint du phong.`, {
          ...stepContext,
          step: "image_edit_retry",
          style: "warning",
        });
      }
    } finally {
      streams.forEach((stream) => stream.destroy());
    }
  }

  const detail = lastError?.message ? ` Loi cuoi: ${lastError.message}` : "";
  throw new Error(`Khong ket noi duoc ShopAIKey sau khi thu ${baseUrls.length} endpoint.${detail}`);
}

async function processPhotoProduct(files, outputFormat, workerId, jobId, jobResultDir) {
  const stepContext = {
    workerId,
    profileId: jobId,
  };

  log("STEP", `Gui ${files.length} anh tham chieu de tao 1 anh the duy nhat`, {
    ...stepContext,
    step: "send_reference_set",
    style: "step",
  });

  const { response, retries } = await editImageSetWithFallback(files, stepContext);

  log("STEP", "Chuan hoa 1 anh ket qua ve 945x1417 px, 600 DPI", {
    ...stepContext,
    step: "normalize_4x6",
    style: "step",
  });

  const generatedBuffer = await imageResponseToBuffer(response.data?.[0]);
  const normalizedBuffer = await normalizeImage(generatedBuffer, outputFormat);
  const extension = outputFormat === "jpg" || outputFormat === "jpeg" ? "jpg" : "png";
  const fileName = `${safeBaseName(files[0].originalname)}-id-photo-${Date.now()}.${extension}`;
  const outputPath = path.join(jobResultDir, fileName);

  await fs.promises.writeFile(outputPath, normalizedBuffer);

  log("OK", `Da luu 1 anh the ket qua: ${outputPath}`, {
    ...stepContext,
    step: "save_result",
    style: "success",
  });

  return {
    result: {
      id: `${jobId}-result`,
      originalName: `${files.length} anh tham chieu`,
      sourceCount: files.length,
      fileName,
      jobId,
      url: publicResultPath(jobId, fileName),
      width: targetWidth,
      height: targetHeight,
      dpi: targetDensity,
      format: extension,
    },
    retries,
  };
}

app.get("/api/config", (request, response) => {
  response.json({
    model: imageModel,
    baseUrl: apiBaseUrl.replace(/^https?:\/\//, ""),
    fallbackBaseUrl: fallbackApiBaseUrl.replace(/^https?:\/\//, ""),
    generationSize,
    target: {
      label: "4x6 cm",
      width: targetWidth,
      height: targetHeight,
      dpi: targetDensity,
    },
    outputMode: "reference_set_to_single_photo",
  });
});

app.post("/api/process", upload.array("images", 4), async (request, response) => {
  const startedAt = Date.now();
  const jobId = randomUUID();
  const jobResultDir = path.join(resultDir, jobId);
  const files = request.files || [];
  const outputFormat = ["png", "jpg", "jpeg"].includes(request.body.outputFormat)
    ? request.body.outputFormat
    : "jpg";
  const workerId = `run-${startedAt}`;

  log("INFO", "Khoi dong luot xu ly anh the", {
    workerId,
    profileId: jobId,
    step: "startup",
  });
  log("INFO", `Config: input_images=${files.length}, output_images=1, mode=reference_set, concurrency=1, method=ShopAIKey images.edit, model=${imageModel}, size=${generationSize}, output=${outputFormat}`, {
    workerId,
    step: "config",
  });

  try {
    if (files.length < 1 || files.length > 4) {
      response.status(400).json({ error: "Vui long upload tu 1 den 4 anh." });
      return;
    }

    await fs.promises.mkdir(jobResultDir, { recursive: true });

    let retries = 0;
    let result = null;
    let failed = 0;

    try {
      const processed = await processPhotoProduct(files, outputFormat, workerId, jobId, jobResultDir);
      result = processed.result;
      retries = processed.retries;
    } catch (error) {
      failed = 1;
      log("ERROR", `${error.message}. Goi y: kiem tra API key, model, quota, endpoint hoac dinh dang anh nguon.`, {
        workerId,
        profileId: jobId,
        step: "process_reference_set",
        style: "error",
      });
      result = {
        originalName: `${files.length} anh tham chieu`,
        sourceCount: files.length,
        error: error.message,
      };
    }

    const elapsedMs = Date.now() - startedAt;
    const success = failed ? 0 : 1;
    log("DONE", `Tong ket: input=${files.length}, output=1, success=${success}, failed=${failed}, skipped=0, retries=${retries}, elapsed=${elapsedMs}ms`, {
      workerId,
      step: "summary",
      style: failed ? "warning" : "success",
    });

    response.json({
      jobId,
      results: [result],
      summary: {
        total: 1,
        inputCount: files.length,
        outputCount: 1,
        success,
        failed,
        skipped: 0,
        retries,
        elapsedMs,
      },
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    log("ERROR", `${error.message}. Goi y: kiem tra file .env va cau hinh ShopAIKey.`, {
      workerId,
      profileId: jobId,
      step: "request",
      style: "error",
    });
    response.status(statusCode).json({ error: error.message });
  } finally {
    await Promise.allSettled(files.map((file) => fs.promises.unlink(file.path)));
  }
});

app.use((error, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  log("ERROR", `${error.message}. Goi y: kiem tra so luong file, dung luong file hoac dinh dang anh.`, {
    step: "upload",
    style: "error",
  });
  response.status(400).json({ error: error.message });
});

app.get("*", (request, response, next) => {
  const indexPath = path.join(distDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    next();
    return;
  }
  response.sendFile(indexPath);
});

app.listen(port, "127.0.0.1", () => {
  log("INFO", `API server san sang tai http://127.0.0.1:${port}`, {
    step: "startup",
  });
  log("INFO", `Startup summary: input_images=1-4, output_images=1, execution_mode=api, concurrency=1, automation_method=HTTP API, model=${imageModel}`, {
    step: "startup_summary",
  });
});
