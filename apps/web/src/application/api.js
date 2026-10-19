let csrf = null;
export async function api(path, options = {}) {
  const anonymous =
    path.startsWith("/anonymous/") || path.startsWith("/public/");
  const response = await fetch(`/api${path}`, {
    credentials: anonymous ? "omit" : "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(csrf && !anonymous ? { "X-CSRF-Token": csrf } : {}),
      ...options.headers,
    },
  });
  const data = await response
    .json()
    .catch(() => ({
      error: { message: "Service returned an unreadable response." },
    }));
  if (!response.ok) {
    const error = new Error(data.error?.message || "Request failed.");
    error.code = data.error?.code;
    throw error;
  }
  if (Object.hasOwn(data, "csrf")) csrf = data.csrf;
  return data;
}
export const post = (path, body) =>
  api(path, { method: "POST", body: JSON.stringify(body) });
export async function command(name, payload, requestId) {
  const material = new TextEncoder().encode(
    JSON.stringify({ name, payload, csrf })
  );
  const key = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", material))
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  const pending = JSON.parse(
    sessionStorage.getItem("lotus.pending-commands") || "{}"
  );
  const id = requestId || pending[key] || crypto.randomUUID();
  pending[key] = id;
  sessionStorage.setItem("lotus.pending-commands", JSON.stringify(pending));
  try {
    const result = await post("/commands", {
      command: name,
      payload,
      requestId: id,
    });
    delete pending[key];
    sessionStorage.setItem("lotus.pending-commands", JSON.stringify(pending));
    return result;
  } catch (error) {
    if (
      error.code &&
      ![
        "COMMIT_UNKNOWN",
        "SERVICE_UNAVAILABLE",
        "FIREFLY_UNAVAILABLE",
      ].includes(error.code)
    ) {
      delete pending[key];
      sessionStorage.setItem("lotus.pending-commands", JSON.stringify(pending));
    }
    throw error;
  }
}
export const date = (seconds) =>
  new Date(Number(seconds) * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
export const bytesToBase64 = (bytes) => {
  let value = "";
  for (let i = 0; i < bytes.length; i += 8192)
    value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
};
export const base64ToBytes = (value) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
export async function upload(file, isPublic = true) {
  if (file.size > 5 * 1024 * 1024)
    throw new Error("Choose a document under 5 MB.");
  return post("/documents", {
    name: file.name,
    mime: file.type,
    public: isPublic,
    base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
  });
}
export function parsePackCode(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    const url = new URL(value, location.origin);
    parsed = {
      code: url.searchParams.get("code") || url.searchParams.get("ndc"),
      lotNumber: url.searchParams.get("lot"),
      namespace: url.searchParams.get("namespace") || "NDC",
    };
  }
  if (
    typeof parsed.code !== "string" ||
    typeof parsed.lotNumber !== "string" ||
    !["NDC", "GTIN", "LOCAL"].includes(parsed.namespace || "NDC")
  )
    throw new Error(
      "This code does not contain a supported medicine product and lot."
    );
  return {
    code: parsed.code,
    lotNumber: parsed.lotNumber,
    namespace: parsed.namespace || "NDC",
  };
}
