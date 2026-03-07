import { useEffect, useState, useCallback } from "react";
import "./App.css";
import PRList from "./components/PRList";
import PRModal from "./components/PRModal";
import NotificationBell from "./components/NotificationBell";
import { API_CONFIG, fetchAllPRs } from "./services/api";
import {
  Check,
  Ban,
  Lock,
  Clock,
  ChevronsLeftRightEllipsis,
  GitPullRequest,
  Users,
  Menu,
  X as XIcon,
} from "lucide-react";

export default function App() {
  const [prs, setPrs] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [teamsOnline, setTeamsOnline] = useState(23);
  const [notifications, setNotifications] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [timeLeft, setTimeLeft] = useState(2 * 3600 + 14 * 60 + 23);

  const [currentView, setCurrentView] = useState("prs");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isLocked = timeLeft <= 0;

  useEffect(() => {
    const timer = setInterval(
      () => setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600)
      .toString()
      .padStart(2, "0");
    const m = Math.floor((seconds % 3600) / 60)
      .toString()
      .padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  const loadData = useCallback(() => {
    fetchAllPRs().then((data) => setPrs(data));
  }, []);

useEffect(() => {
    loadData();

    let ws;
    let reconnectTimer;
    const connectWebSocket = () => {
      ws = new WebSocket(API_CONFIG.WS);

      ws.onopen = () => {
        console.log("WebSocket Connected!");
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          
          if (msg.type === "new_pr" && !isLocked) {
            setPrs((prev) => {
              if (prev.find(p => String(p.id) === String(msg.pr.id))) return prev;
              return [msg.pr, ...prev];
            });
            
            setNotifications((prev) => [
              { id: Date.now(), team: msg.pr.team, title: msg.pr.title, pr: msg.pr },
              ...prev,
            ]);

            const toastId = Date.now();
            setToasts((prev) => [...prev, { id: toastId, text: `${msg.pr.team} submitted a PR` }]);
            setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== toastId)), 4000);
            
          } else if (msg.type === "status_update") {
            setPrs((prev) =>
              prev.map((p) =>
                String(p.id) === String(msg.prId)
                  ? { ...p, status: msg.status, mergedCount: msg.newCount || p.mergedCount }
                  : p
              )
            );
          } else if (msg.type === "teams_online") {
            setTeamsOnline(msg.count);
          }
        } catch (e) {
          console.error("WebSocket message error:", e);
        }
      };

      ws.onclose = () => {
        console.log("WebSocket Disconnected. Reconnecting in 3s...");
        reconnectTimer = setTimeout(connectWebSocket, 3000);
      };
      
      ws.onerror = () => {
        ws.close();
      };
    };
    connectWebSocket();
    return () => {
      if (ws) {
        ws.onclose = null; 
        ws.close();
      }
      clearTimeout(reconnectTimer);
    };
  }, [loadData, isLocked]);

  const handleApprove = async (prId, comment) => {
    const targetPr = prs.find(p => p.id === prId);
    if (!targetPr) return;

    setSelected(null);
    
    try {
      const response = await fetch(`${API_CONFIG.BASE}/pr/${targetPr.repo}/${prId}/approve`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: comment || "" }) 
      });

      if (response.ok) {
        setPrs((prev) => prev.map((p) => String(p.id) === String(prId) ? { ...p, status: "merged", mergedCount: (p.mergedCount || 0) + 1 } : p));

        const toastId = Date.now();
        setToasts((prev) => [...prev, { id: toastId, text: (<><Check size={16} className="inline mr-2" /> PR Approved on GitHub!</>) }]);
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== toastId)), 3000);
      } else {
        const errorData = await response.json();
        alert(`GitHub rejected the merge: ${errorData.detail}`);
      }
    } catch (e) {
      console.error("Network error:", e);
    }
  };

  const handleReject = async (prId, comment) => {
    const targetPr = prs.find(p => p.id === prId);
    if (!targetPr) return;

    setSelected(null);
    
    try {
      const response = await fetch(`${API_CONFIG.BASE}/pr/${targetPr.repo}/${prId}/reject`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: comment || "" }) 
      });

      if (response.ok) {
        setPrs((prev) => prev.map((p) => String(p.id) === String(prId) ? { ...p, status: "rejected" } : p));

        const toastId = Date.now();
        setToasts((prev) => [...prev, { id: toastId, text: (<><Ban size={16} className="inline mr-2" /> PR Rejected & Closed</>) }]);
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== toastId)), 3000);
      } else {
        const errorData = await response.json();
        alert(`GitHub failed to close PR: ${errorData.detail}`);
      }
    } catch (e) {
      console.error("Network error:", e);
    }
  };

  const allTeamsMap = {};
  prs.forEach((pr) => {
    if (!allTeamsMap[pr.team]) {
      allTeamsMap[pr.team] = {
        team: pr.team,
        mergedCount: 0,
        members: pr.members || [],
      };
    }
    if (pr.status === "merged") {
      allTeamsMap[pr.team].mergedCount += 1;
    }
    if (!allTeamsMap[pr.team].members?.length && pr.members) {
      allTeamsMap[pr.team].members = pr.members;
    }
  });
  const sortedTeams = Object.values(allTeamsMap).sort(
    (a, b) => b.mergedCount - a.mergedCount,
  );
  const filteredPRs = prs
    .filter((pr) => {
      if (statusFilter === "all") return true;
      if (statusFilter === "merged") return pr.status === "merged";
      if (statusFilter === "pending") return pr.status === "open";
      return true;
    })
    .filter(
      (pr) =>
        (pr.team || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (pr.title || "").toLowerCase().includes(searchQuery.toLowerCase()),
    );

  const filteredTeams = sortedTeams.filter((team) =>
    team.team.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="app-container">
      {/* Mobile overlay */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Commit & Conquer</span>
          <button
            className="hamburger"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
            style={{ marginRight: "-4px" }}
          >
            <XIcon size={20} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div
            style={{
              fontSize: "11px",
              fontWeight: "600",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: "8px",
            }}
          >
            Menu
          </div>

          <button
            onClick={() => { setCurrentView("prs"); setSidebarOpen(false); }}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 16px",
              background:
                currentView === "prs" ? "var(--bg-card)" : "transparent",
              border: `1px solid ${
                currentView === "prs" ? "var(--border-light)" : "transparent"
              }`,
              borderRadius: "12px",
              cursor: "pointer",
              fontWeight: "600",
              color:
                currentView === "prs"
                  ? "var(--text-main)"
                  : "var(--text-muted)",
              boxShadow:
                currentView === "prs" ? "0 2px 8px rgba(0,0,0,0.04)" : "none",
              transition: "all 0.2s",
              width: "100%",
              textAlign: "left",
            }}
          >
            <span
              style={{ display: "flex", alignItems: "center", gap: "12px" }}
            >
              <GitPullRequest size={18} />
              <span style={{ lineHeight: 1 }}>Submissions</span>
            </span>
          </button>

          <button
            onClick={() => { setCurrentView("teams"); setSidebarOpen(false); }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 16px",
              background:
                currentView === "teams" ? "var(--bg-card)" : "transparent",
              border: `1px solid ${currentView === "teams" ? "var(--border-light)" : "transparent"}`,
              borderRadius: "12px",
              cursor: "pointer",
              fontWeight: "600",
              color:
                currentView === "teams"
                  ? "var(--text-main)"
                  : "var(--text-muted)",
              boxShadow:
                currentView === "teams" ? "0 2px 8px rgba(0,0,0,0.04)" : "none",
              transition: "all 0.2s",
              width: "100%",
              textAlign: "left",
            }}
          >
            <Users size={18} /> All Teams
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="main-header">
          <div className="header-left">
            <button
              className="hamburger"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={22} />
            </button>
            <input
              type="text"
              placeholder={
                currentView === "prs"
                  ? "Search submissions..."
                  : "Search teams..."
              }
              className="header-search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            {currentView === "prs" && (
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {["all", "merged", "pending"].map((status) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "12px",
                      border:
                        statusFilter === status
                          ? "1px solid var(--text-main)"
                          : "1px solid var(--border-light)",
                      background:
                        statusFilter === status ? "var(--bg-card)" : "#fff",
                      fontSize: "13px",
                      fontWeight: "600",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="header-right">
            <div
              className="header-timer"
              style={{
                color: isLocked
                  ? "var(--status-rejected-text)"
                  : "var(--text-main)",
              }}
            >
              {isLocked ? (
                <>
                  <Lock size={16} className="inline mr-1" /> Submissions Closed
                </>
              ) : (
                <>
                  <Clock size={16} className="inline mr-1" /> Submissions close
                  in: {formatTime(timeLeft)}
                </>
              )}
            </div>

            <div className="header-online" style={{ color: "var(--text-main)" }}>
              <ChevronsLeftRightEllipsis size={16} /> {teamsOnline} Teams Online
            </div>
            <NotificationBell
              items={notifications}
              onClear={() => setNotifications([])}
              onClickItem={(pr) => {
                setSelected(pr);
                setCurrentView("prs");
              }}
            />
          </div>
        </header>

        {currentView === "prs" ? (
          <PRList prs={filteredPRs} onOpen={setSelected} />
        ) : (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "12px" }}
          >
            <h2
              style={{
                fontSize: "20px",
                marginBottom: "16px",
                color: "var(--text-main)",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <Users size={24} /> Registered Teams
            </h2>
            {filteredTeams.length === 0 ? (
              <div
                style={{
                  padding: "40px",
                  textAlign: "center",
                  color: "var(--text-muted)",
                  fontSize: "13px",
                  border: "1px solid var(--border-light)",
                  borderRadius: "12px",
                  background: "var(--bg-card)",
                }}
              >
                No teams found.
              </div>
            ) : (
              filteredTeams.map((team, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "20px 24px",
                    background: "var(--bg-card)",
                    borderRadius: "12px",
                    border: "1px solid var(--border-light)",
                    boxShadow: "0 2px 10px rgba(0,0,0,0.02)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "20px",
                    }}
                  >
                    <div
                      style={{
                        width: "44px",
                        height: "44px",
                        borderRadius: "12px",
                        background: "var(--bg-main)",
                        border: "1px solid var(--border-light)",
                        color: "var(--text-muted)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Users size={20} />
                    </div>
                    <div>
                      <div
                        style={{
                          fontWeight: "700",
                          fontSize: "16px",
                          color: "var(--text-main)",
                        }}
                      >
                        {team.team}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          marginTop: "8px",
                        }}
                      >
                        {team.members && team.members.length > 0 ? (
                          team.members.map((initials, i) => (
                            <span
                              key={i}
                              style={{
                                fontSize: "11px",
                                background: "var(--bg-main)",
                                padding: "4px 10px",
                                borderRadius: "6px",
                                color: "var(--text-muted)",
                                fontWeight: "600",
                                border: "1px solid var(--border-light)",
                              }}
                            >
                              {initials}
                            </span>
                          ))
                        ) : (
                          <span
                            style={{
                              fontSize: "12px",
                              color: "var(--text-muted)",
                            }}
                          >
                            No members listed
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div
                      style={{
                        fontWeight: "800",
                        fontSize: "20px",
                        color: "var(--text-main)",
                      }}
                    >
                      {team.mergedCount}
                    </div>
                    <div
                      style={{
                        fontSize: "11px",
                        color: "var(--text-muted)",
                        textTransform: "uppercase",
                        fontWeight: "600",
                        letterSpacing: "0.5px",
                      }}
                    >
                      Approved Merges
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>

      {selected && (
        <PRModal
          pr={selected}
          onClose={() => setSelected(null)}
          onApprove={handleApprove}
          onReject={handleReject}
          isLocked={isLocked}
        />
      )}

      <div
        style={{
          position: "fixed",
          bottom: "24px",
          left: "24px",
          zIndex: 9999,
          display: "flex",
          flexDirection: "column-reverse",
          gap: "8px",
          alignItems: "flex-start",
        }}
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            style={{
              background: "#111",
              color: "#fff",
              padding: "12px 20px",
              borderRadius: "12px",
              fontSize: "13px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              animation: "fadeIn 0.3s ease-out",
              width: "fit-content",
              maxWidth: "320px",
            }}
          >
            {toast.text}
          </div>
        ))}
      </div>
    </div>
  );
}