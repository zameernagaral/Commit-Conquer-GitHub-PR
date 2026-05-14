export const API_CONFIG = {
  BASE: import.meta.env.VITE_API_URL || "https://commit-conquer-github-pr.onrender.com/api",
  WS:   import.meta.env.VITE_WS_URL  || "wss://commit-conquer-github-pr.onrender.com/api/live",
};

async function apiFetch(path, init = {}, adminToken = "") {
  const headers = { "Content-Type": "application/json" };
  if (adminToken) headers["x-admin-token"] = adminToken;
  const res = await fetch(`${API_CONFIG.BASE}${path}`, { headers, ...init });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `API ${res.status}`);
  }
  return res.json();
}

// PRs
export const fetchAllPRs = (params = {}) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v && q.set(k, v));
  return apiFetch(`/prs?limit=200${q.toString() ? "&" + q : ""}`).then(r => r.prs ?? r);
};
export const fetchPRDiff      = (repo, n) => apiFetch(`/pr/${repo}/${n}`);
export const fetchPRFiles     = (repo, n) => apiFetch(`/pr/${repo}/${n}/files`);
export const approvePR        = (repo, n, comment) => apiFetch(`/pr/${repo}/${n}/approve`, { method: "POST", body: JSON.stringify({ comment }) });
export const rejectPR         = (repo, n, comment) => apiFetch(`/pr/${repo}/${n}/reject`,  { method: "POST", body: JSON.stringify({ comment }) });
export const setManualScore   = (repo, n, manual_score, note, token) =>
  apiFetch(`/prs/${repo}/${n}/manual_score`, { method: "PATCH", body: JSON.stringify({ manual_score, note }) }, token);

// Scores
export const fetchScore       = (repo, n)    => apiFetch(`/scores/${repo}/${n}`).catch(() => null);
export const fetchPendingScores = (token)    => apiFetch("/scores/pending", {}, token);
export const approveScore     = (repo, n, token) => apiFetch(`/scores/${repo}/${n}/approve`, { method: "POST" }, token);
export const rejectScore      = (repo, n, token) => apiFetch(`/scores/${repo}/${n}/pending`, { method: "DELETE" }, token);

// Leaderboard
export const fetchLeaderboard = (page = 1, limit = 100, mode = "individual") =>
  apiFetch(`/leaderboard?page=${page}&limit=${limit}&mode=${mode}`);
export const fetchParticipant = (u) => apiFetch(`/leaderboard/participant/${u}`);

// Issues
export const fetchIssues      = (params = {}) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v && q.set(k, v));
  return apiFetch(`/issues?${q}`);
};
export const createIssue      = (body, token) => apiFetch("/issues", { method: "POST", body: JSON.stringify(body) }, token);
export const deleteIssue      = (repo, n, token) => apiFetch(`/issues/${repo}/${n}`, { method: "DELETE" }, token);
export const updateIssue      = (repo, n, body, token) => apiFetch(`/issues/${repo}/${n}`, { method: "PATCH", body: JSON.stringify(body) }, token);

// Teams
export const fetchTeams       = ()             => apiFetch("/teams");
export const createTeam       = (body, token)  => apiFetch("/teams", { method: "POST", body: JSON.stringify(body) }, token);
export const updateTeam       = (id, body, tk) => apiFetch(`/teams/${id}`, { method: "PATCH", body: JSON.stringify(body) }, tk);
export const deleteTeam       = (id, token)    => apiFetch(`/teams/${id}`, { method: "DELETE" }, token);
export const addTeamMember    = (id, username, token) => apiFetch(`/teams/${id}/members`, { method: "POST", body: JSON.stringify({ username }) }, token);
export const removeTeamMember = (id, username, token) => apiFetch(`/teams/${id}/members/${username}`, { method: "DELETE" }, token);

// Admin
export const fetchAdminConfig = (token)        => apiFetch("/admin/config", {}, token);
export const updateAdminConfig = (token, body) => apiFetch("/admin/config", { method: "PATCH", body: JSON.stringify(body) }, token);
export const recalculateAll   = (token)        => apiFetch("/admin/recalculate", { method: "POST" }, token);
export const fetchActivity    = (token)        => apiFetch("/admin/activity", {}, token);
export const banUser          = (u, token)     => apiFetch(`/admin/ban/${u}`, { method: "POST" }, token);
export const unbanUser        = (u, token)     => apiFetch(`/admin/ban/${u}`, { method: "DELETE" }, token);
export const fetchBanned      = (token)        => apiFetch("/admin/banned", {}, token);

// Export
export const exportCSV = (token) => {
  window.open(`${API_CONFIG.BASE}/export/leaderboard?x-admin-token=${token}`);
};


// Manual score assignment
export const assignScore = (username, points, note, replace, token) =>
  apiFetch(`/assign/${username}`, {
    method: "POST",
    body: JSON.stringify({ points: Number(points), note, replace }),
  }, token);