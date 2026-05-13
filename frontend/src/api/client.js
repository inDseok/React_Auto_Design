export const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

function toErrorMessage(error) {
  if (error instanceof TypeError) {
    return "백엔드 서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인하세요. (http://127.0.0.1:8000)";
  }
  return String(error?.message ?? error);
}

async function request(path, options) {
  try {
    return await fetch(`${API_BASE}${path}`, options);
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function apiGet(path) {
  const res = await request(path, {
    method: "GET",
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function apiPost(path, body) {
  const res = await request(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function apiUpload(path, formData) {
  const res = await request(path, {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  return res.json();
}

export async function apiPatch(path, body) {
  const res = await request(path, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PATCH ${path} failed: ${res.status} ${text}`);
  }

  return res.json();
}

export async function apiDelete(url) {
  const res = await request(url, {
    method: "DELETE",
    credentials: "include",   // ⭐⭐⭐ 이 줄이 핵심
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `DELETE failed: ${res.status}`);
  }

  return await res.json();
}
