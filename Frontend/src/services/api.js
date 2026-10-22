const configuredBaseUrl = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000"
).replace(/\/+$/, "");

export const API_BASE_URL = `${configuredBaseUrl.replace(/(?:\/api)+$/i, "")}/api`;

export class ApiError extends Error {
  constructor(message, status, payload, fieldErrors = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
    this.fieldErrors = Array.isArray(fieldErrors)
      ? fieldErrors
      : Array.isArray(payload?.errors)
        ? payload.errors
        : [];
  }
}

async function requestJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      credentials: options.credentials || "include",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }
    throw new ApiError(
      "Could not contact the GrantWise API. Check that the backend is running and allows this frontend origin.",
      null,
      null,
    );
  }
  const responseText = await response.text();
  let payload = null;

  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = { message: responseText };
    }
  }

  if (!response.ok) {
    throw new ApiError(
      payload?.message || `Request failed with status ${response.status}.`,
      response.status,
      payload,
      payload?.errors,
    );
  }

  return payload;
}

export async function apiRequest(path, options = {}) {
  const normalizedPath = path.replace(/^\/+/, "").replace(/^(?:api\/)+/i, "");
  return requestJson(`${API_BASE_URL}/${normalizedPath}`, options);
}

export async function getApiHealth() {
  const apiOrigin = API_BASE_URL.replace(/\/api\/?$/, "");
  return requestJson(`${apiOrigin}/`);
}
