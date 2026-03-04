

export const API_CONFIG = {
  BASE: "http://localhost:8000/api",
  WS: "ws://localhost:8000/api/live",
  REPO_NAME: "commit-conquer" 
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