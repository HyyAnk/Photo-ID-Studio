import fs from "node:fs/promises";
import os from "node:os";

import formidable from "formidable";

import { log } from "../server/logger.js";
import { getImageModels, processPhotoProduct } from "./_photo-service.js";

export const config = {
  api: {
    bodyParser: false,
  },
  maxDuration: 300,
};

const maxFiles = 4;
const maxFileSize = 1.6 * 1024 * 1024;
const maxTotalFileSize = 4.2 * 1024 * 1024;

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function parseMultipart(request) {
  const form = formidable({
    multiples: true,
    uploadDir: os.tmpdir(),
    keepExtensions: true,
    maxFiles,
    maxFileSize,
    maxTotalFileSize,
    filter: (part) => part.name === "images" && part.mimetype?.startsWith("image/"),
  });

  return new Promise((resolve, reject) => {
    form.parse(request, (error, fields, files) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ fields, files });
    });
  });
}

async function cleanup(files) {
  await Promise.allSettled(
    files
      .map((file) => file.filepath)
      .filter(Boolean)
      .map((filepath) => fs.unlink(filepath)),
  );
}

export default async function handler(request, response) {
  const startedAt = Date.now();
  const workerId = `vercel-${startedAt}`;
  let uploadedFiles = [];

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const parsed = await parseMultipart(request);
    const imageField = parsed.files.images || [];
    uploadedFiles = Array.isArray(imageField) ? imageField : [imageField];
    const outputFormatValue = firstValue(parsed.fields.outputFormat);
    const outputFormat = ["png", "jpg", "jpeg"].includes(outputFormatValue) ? outputFormatValue : "jpg";
    const requestedModel = firstValue(parsed.fields.model) || getImageModels()[0];

    log("INFO", "Starting Vercel image processing request", {
      workerId,
      step: "startup",
    });
    log(
      "INFO",
      `Config: input_images=${uploadedFiles.length}, output_images=1, mode=reference_set, concurrency=1, method=Vercel Function + ShopAIKey images.edit, model=${requestedModel}, output=${outputFormat}`,
      {
        workerId,
        step: "config",
      },
    );

    if (uploadedFiles.length < 1 || uploadedFiles.length > maxFiles) {
      response.status(400).json({ error: "Please upload from 1 to 4 compressed image files." });
      return;
    }

    if (!getImageModels().includes(requestedModel)) {
      response.status(400).json({ error: "Model is not allowed by server config." });
      return;
    }

    const { jobId, retries, result } = await processPhotoProduct(uploadedFiles, outputFormat, workerId, requestedModel);
    const elapsedMs = Date.now() - startedAt;

    log("DONE", `Summary: total=1, success=1, failed=0, skipped=0, retries=${retries}, elapsed=${elapsedMs}ms`, {
      workerId,
      profileId: jobId,
      step: "summary",
      style: "success",
    });

    response.status(200).json({
      jobId,
      results: [result],
      summary: {
        total: 1,
        inputCount: uploadedFiles.length,
        outputCount: 1,
        success: 1,
        failed: 0,
        skipped: 0,
        retries,
        model: requestedModel,
        elapsedMs,
      },
    });
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const statusCode = error.statusCode || error.httpCode || 500;
    log("ERROR", `${error.message}. Suggested action: check compressed file size, API key, model, quota, endpoint, or source image format.`, {
      workerId,
      step: "request",
      style: "error",
    });
    response.status(statusCode).json({
      error: error.message,
      summary: {
        total: 1,
        success: 0,
        failed: 1,
        skipped: 0,
        retries: 0,
        elapsedMs,
      },
    });
  } finally {
    await cleanup(uploadedFiles);
  }
}
