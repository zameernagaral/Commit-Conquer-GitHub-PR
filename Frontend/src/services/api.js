export const API_BASE = "http://localhost:8000"; 
export const WS_URL = "ws://localhost:8000/ws";

export const API_CONFIG = {
  BASE: API_BASE,
  WS: WS_URL,
  ENDPOINTS: {
    PRS: `${API_BASE}/prs`,
    MERGE: (id) => `${API_BASE}/merge/${id}`,
  }
};
export const fetchAllPRs = async () => {
  return [
    { id: '1', team: 'Alpha Squad', title: 'Fixed Navbar responsiveness', status: 'open', code: 'const x = 10;', mergedCount: 2 },
    { id: '2', team: 'Beta Builders', title: 'Added Dark Mode support', status: 'merged', code: 'body { color: white; }', mergedCount: 5 },
    { id: '3', team: 'CodeIO Web', title: 'Update API Endpoints', status: 'open', code: 'fetch("/api/v2/users")', mergedCount: 0 },
  ];

  /*UNCOMMENT THIS LATER AFTER BACKEND FINISHES
  try {
    const response = await fetch(API_CONFIG.ENDPOINTS.PRS);
    return await response.json();
  } catch (e) { return []; }
  */
};
export const mergePR = async (id) => {
  console.log(`Simulating Merge for PR: ${id}`);
  return { success: true };

  /* UNCOMMENT THIS LATER AFTER BACKEND FINISHES
  return fetch(API_CONFIG.ENDPOINTS.MERGE(id), { method: 'POST' });
  */
};