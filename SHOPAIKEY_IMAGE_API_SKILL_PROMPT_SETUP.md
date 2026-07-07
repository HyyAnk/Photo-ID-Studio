# ShopAIKey Image API Skill Prompt Setup

Use this file as a reusable setup prompt when adding ShopAIKey image generation to other projects.

## Core Instruction

You are a coding agent setting up an image generation tool with the ShopAIKey API using the OpenAI-compatible format.

Primary goals:

- Use the ShopAIKey API to generate images from text prompts.
- If the project provides reference/input images, use the image edit/reference endpoint to send images with the prompt.
- Never hard-code API keys in source code.
- Save generated images as files in the project's output/result folder.
- Keep the application workflow flexible. This prompt only defines the API foundation, configuration, logging, error handling, and output saving pattern.

## Required Defaults

- Primary base URL: `https://direct.shopaikey.com/v1`
- Fallback base URL: `https://api.shopaikey.com/v1`
- API key environment variable: `SHOPAIKEY_API_KEY`
- Base URL environment variable: `SHOPAIKEY_BASE_URL`
- Image model environment variable: `SHOPAIKEY_IMAGE_MODEL`
- Default image model: `gpt-image-2`
- Default size: `1536x1024`
- Default quality: `high`
- Default output format: `png`

## Endpoint Selection

Use one of these routes depending on the project requirements:

- Text-to-image only: `POST /v1/images/generations`
- Prompt plus input/reference images: `POST /v1/images/edits`

For `images/edits`, send files as multipart form data. Support 1 to 4 input images unless the project specifies a different limit.

## Environment Setup

Create `.env`:

```env
SHOPAIKEY_API_KEY=your_shopaikey_api_key_here
SHOPAIKEY_BASE_URL=https://direct.shopaikey.com/v1
SHOPAIKEY_IMAGE_MODEL=gpt-image-2
```

Never commit `.env`.

Create `.env.example`:

```env
SHOPAIKEY_API_KEY=your_shopaikey_api_key_here
SHOPAIKEY_BASE_URL=https://direct.shopaikey.com/v1
SHOPAIKEY_IMAGE_MODEL=gpt-image-2
```

## Python SDK Pattern

Use this pattern when the project accepts the `openai` Python SDK dependency.

Install dependencies:

```bash
pip install openai python-dotenv
```

Text-to-image:

```python
from __future__ import annotations

import base64
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(
    api_key=os.environ["SHOPAIKEY_API_KEY"],
    base_url=os.getenv("SHOPAIKEY_BASE_URL", "https://direct.shopaikey.com/v1"),
)

response = client.images.generate(
    model=os.getenv("SHOPAIKEY_IMAGE_MODEL", "gpt-image-2"),
    prompt="Describe the image to create here.",
    size="1536x1024",
    quality="high",
    output_format="png",
)

output_dir = Path("result")
output_dir.mkdir(parents=True, exist_ok=True)
image_bytes = base64.b64decode(response.data[0].b64_json)
(output_dir / "generated.png").write_bytes(image_bytes)
```

Prompt plus reference images:

```python
from __future__ import annotations

import base64
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(
    api_key=os.environ["SHOPAIKEY_API_KEY"],
    base_url=os.getenv("SHOPAIKEY_BASE_URL", "https://direct.shopaikey.com/v1"),
)

image_paths = [
    Path("input/reference_1.png"),
    Path("input/reference_2.png"),
]

images = [path.open("rb") for path in image_paths]
try:
    response = client.images.edit(
        model=os.getenv("SHOPAIKEY_IMAGE_MODEL", "gpt-image-2"),
        image=images,
        prompt="Describe how to use or transform the reference images here.",
        size="1536x1024",
        quality="high",
        output_format="png",
    )
finally:
    for image in images:
        image.close()

output_dir = Path("result")
output_dir.mkdir(parents=True, exist_ok=True)
image_bytes = base64.b64decode(response.data[0].b64_json)
(output_dir / "generated_from_refs.png").write_bytes(image_bytes)
```

If `output_format` is rejected by the provider, make it configurable and retry only when the project owner explicitly requests fallback behavior. Do not silently change user-requested image settings.

## Raw HTTP Pattern

Use raw HTTP when the project should avoid SDK dependencies.

Text-to-image JSON body:

```json
{
  "model": "gpt-image-2",
  "prompt": "Describe the image to create here.",
  "size": "1536x1024",
  "quality": "high",
  "output_format": "png"
}
```

Request:

```bash
curl -X POST "https://direct.shopaikey.com/v1/images/generations" \
  -H "Authorization: Bearer $SHOPAIKEY_API_KEY" \
  -H "Content-Type: application/json" \
  -d @payload.json
```

For reference images, send multipart form data to:

```text
https://direct.shopaikey.com/v1/images/edits
```

Required multipart fields:

- `model`
- `prompt`
- `size`
- `quality`
- `output_format`
- one or more `image[]` file fields

## Response Handling

Handle both response shapes:

- Preferred/current GPT image response: `data[0].b64_json`
- Provider fallback/legacy response: `data[0].url`

If `b64_json` exists, base64-decode it and write the bytes to a `.png` file.

If `url` exists, download the URL immediately because generated image URLs may be temporary.

Always create the output directory before saving files.

## Logging Requirements For Generated Tools

When creating scripts or CLI tools:

- Use structured logs, not raw `print()` for normal logs.
- Include timestamp, level, current step, and output path.
- Log startup config without exposing the API key.
- Log selected endpoint, model, size, quality, input image count, and output folder.
- Log final summary: success, failed, skipped, retries, and elapsed time.
- On errors, include the likely next action: missing key, bad endpoint, unsupported model, invalid input image, timeout, quota, or rate limit.

Do not use OS-level mouse, keyboard, clipboard, screen-coordinate clicking, or focus-stealing automation. Image generation must use HTTP API, SDK, or browser protocol only if a browser is explicitly required by the project.

## Validation Checklist

Before considering the setup complete:

- `.env.example` exists and contains ShopAIKey variables.
- API key is read from environment or `.env`, never hard-coded.
- Base URL defaults to `https://direct.shopaikey.com/v1`.
- Model defaults to `gpt-image-2` and is configurable.
- Text-to-image route works or is ready to run.
- Image-reference route works or is ready when input images are provided.
- Output size defaults to `1536x1024`.
- Quality defaults to `high`.
- Output images are saved to a project output/result folder.
- Dry-run or config validation exists when practical.
- Errors are readable and actionable.

## Notes For Future Projects

Do not bake project-specific prompt-building rules into this setup prompt. Let each project define:

- input folder names
- output folder names
- prompt composition rules
- maximum number of reference images
- naming convention for generated files
- whether to use SDK or raw HTTP
- whether to run one image or batch generation

This setup prompt only defines the ShopAIKey image API foundation.
