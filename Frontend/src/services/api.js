
export const API_CONFIG = {
  BASE: "http://127.0.0.1:8000/api",
  WS: "ws://127.0.0.1:8000/api/live"
};

export const fetchAllPRs = async () => {
  try {
    const response = await fetch(`${API_CONFIG.BASE}/prs`);
    if (!response.ok) throw new Error("Network response was not ok");
    return await response.json();
  } catch (error) {
    console.error("Failed to fetch PRs:", error);
    return []; 
  }
};