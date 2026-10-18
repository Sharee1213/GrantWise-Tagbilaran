const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL;

export const API_BASE_URL = (
  configuredBaseUrl || "http://localhost:5000/api"
).replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

async function requestJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }
    throw new ApiError(
      "Unable to connect to the GrantWise API. Check that the service is running and the API URL is correct.",
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
    );
  }

  return payload;
}

export async function apiRequest(path, options = {}) {
  const normalizedPath = path.replace(/^\/+/, "");
  return requestJson(`${API_BASE_URL}/${normalizedPath}`, options);
}

export async function getApiHealth() {
  const apiOrigin = API_BASE_URL.replace(/\/api\/?$/, "");
  return requestJson(`${apiOrigin}/`);
}
