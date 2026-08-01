/**
 * api.js — HTTP fetch wrapper with JWT
 * Admin Panel CronusFit
 */

const API_BASE = 'https://dp5pdbigb1.execute-api.us-east-1.amazonaws.com/prod';

const Api = {
  /**
   * Core request method. Attaches JWT, handles 401 and error responses.
   * SECURITY: JWT is never logged. Only method, path, status, and ISO timestamp are logged.
   *
   * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
   * @param {string} path   - API path (e.g. '/patterns')
   * @param {object|null} body - Request body (JSON-serializable), null for GET/DELETE
   * @returns {Promise<any|undefined>} Parsed JSON response, or undefined on auth redirect
   */
  async request(method, path, body = null) {
    const token = AuthGuard.getToken();
    if (!token) {
      AuthGuard.clear();
      return;
    }

    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    };

    if (body !== null) {
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(`${API_BASE}${path}`, opts);

    // 401 — session expired or invalid: clear auth and redirect
    if (res.status === 401) {
      AuthGuard.clear('expired');
      return;
    }

    // 4xx / 5xx — parse error details and throw
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(data.message ?? data.error ?? res.statusText);
      err.status = res.status;
      err.error = data.error;
      // NOTE: JWT is intentionally excluded from this log
      console.error(`[API] ${method} ${path} → ${res.status} ${new Date().toISOString()}`, data);
      throw err;
    }

    return res.json();
  },

  /** Perform a GET request */
  get: (path) => Api.request('GET', path),

  /** Perform a POST request */
  post: (path, body) => Api.request('POST', path, body),

  /** Perform a PUT request */
  put: (path, body) => Api.request('PUT', path, body),

  /** Perform a DELETE request */
  delete: (path) => Api.request('DELETE', path),
};

window.Api = Api;
