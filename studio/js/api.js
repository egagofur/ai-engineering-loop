export class StudioApiError extends Error {
  constructor(message, { status = 0, code = null, fix = null } = {}) {
    super(message);
    this.name = 'StudioApiError';
    this.status = status;
    this.code = code;
    this.fix = fix;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const options = { method, credentials: 'same-origin', headers: { accept: 'application/json' } };
  if (body !== undefined) {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new StudioApiError('Studio is not reachable. Is `ael studio` still running?');
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || !payload || payload.ok === false) {
    const message = (payload && payload.error) || `Studio answered ${response.status}`;
    throw new StudioApiError(message, { status: response.status, code: payload && payload.code, fix: payload && payload.fix });
  }
  return payload;
}

const segment = (value) => encodeURIComponent(String(value));

export async function fetchProjects() {
  return (await request('/api/projects')).projects;
}

export async function fetchDetail(projectId, runId) {
  return (await request(`/api/projects/${segment(projectId)}/runs/${segment(runId)}`)).detail;
}

export async function fetchMe() {
  const { actor, actorValid, diners = [] } = await request('/api/me');
  return { actor, actorValid, diners: Array.isArray(diners) ? diners : [] };
}

export async function saveActor(actor) {
  const { actor: saved, actorValid, diners = [] } = await request('/api/me', { method: 'PUT', body: { actor } });
  return { actor: saved, actorValid, diners: Array.isArray(diners) ? diners : [] };
}

export async function freezeGoal(projectId, runId, expectedHash) {
  return request(`/api/projects/${segment(projectId)}/runs/${segment(runId)}/goal/freeze`, {
    method: 'POST',
    body: { expectedHash }
  });
}
