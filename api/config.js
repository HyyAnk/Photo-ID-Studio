import { getPublicConfig } from "./_photo-service.js";

export default function handler(request, response) {
  response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=300");
  response.status(200).json(getPublicConfig());
}
