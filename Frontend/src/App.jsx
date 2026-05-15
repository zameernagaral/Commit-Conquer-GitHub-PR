import { useEffect, useState, useCallback, useRef } from "react";
import "./App.css";
import PRList from "./components/PRList";
import PRModal from "./components/PRModal";
import {
  API_CONFIG, fetchAllPRs, fetchLeaderboard, fetchIssues,
  fetchTeams, createTeam, deleteTeam, addTeamMember, removeTeamMember,
  fetchAdminConfig, updateAdminConfig, recalculateAll, fetchActivity,
  fetchPendingScores, approveScore, rejectScore, deleteIssue, createIssue,
  banUser, exportCSV, fetchBanned, unbanUser, setTeamScore,
} from "./services/api";
import {
  GitPullRequest, Trophy, Settings, Menu, X as XIcon, Clock,
  Lock, RefreshCw, Save, Bell, Trash2, Plus, Users, CheckCircle,
  XCircle, Download, Shield, Activity, AlertTriangle,
} from "lucide-react";

const TABS = [
  { id: "prs",         icon: GitPullRequest, label: "Submissions" },
  { id: "leaderboard", icon: Trophy,         label: "Leaderboard" },
  { id: "issues",      icon: AlertTriangle,  label: "Issues"      },
  { id: "admin",       icon: Settings,       label: "Admin"       },
];

export default function App() {
  // Core state
  const [prs,           setPrs]          = useState([]);
  const [leaderboard,   setLeaderboard]  = useState([]);
  const [issues,        setIssues]       = useState([]);
  const [teams,         setTeams]        = useState([]);
  const [selected,      setSelected]     = useState(null);
  const [currentView,   setCurrentView]  = useState("prs");
  const [sidebarOpen,   setSidebarOpen]  = useState(false);

  // Filters
  const [statusFilter,  setStatusFilter] = useState("all");
  const [ciFilter,      setCiFilter]     = useState("all");
  const [searchQuery,   setSearchQuery]  = useState("");

  // Live
  const [wsCount,       setWsCount]      = useState(0);
  const [notifications, setNotifications]= useState([]);
  const [showNotif,     setShowNotif]    = useState(false);
  const [toasts,        setToasts]       = useState([]);

  // Timer
  const [timeLeft,      setTimeLeft]     = useState(null);
  const [eventEndTime,  setEventEndTime] = useState(null);
  const isLocked = timeLeft !== null && timeLeft <= 0;

  // Admin
  const [adminToken,    setAdminToken]   = useState("");
  const [adminAuthed,   setAdminAuthed]  = useState(false);
  const [adminCfg,      setAdminCfg]     = useState({ pr_opened: 5, pipeline_passed: 20, merged_bonus: 15, event_end_time: "" });
  const [adminTab,      setAdminTab]     = useState("config");
  const [adminMsg,      setAdminMsg]     = useState("");
  const [adminErr,      setAdminErr]     = useState("");
  const [pendingScores, setPendingScores]= useState([]);
  const [activityLog,   setActivityLog]  = useState([]);
  const [bannedList,    setBannedList]   = useState([]);
  const [banInput,      setBanInput]     = useState("");
  const [newTeam,       setNewTeam]      = useState({ name: "", members: "" });
  const [newIssue,      setNewIssue]     = useState({ issue_number: "", title: "", repo: "commit-conquer", points: 10, difficulty: "medium" });
  const [lbMode,        setLbMode]       = useState("team");   // "team" | "individual"
  const [teamScoreEdit, setTeamScoreEdit]= useState({});       // { [teamId]: { score: "", note: "" } }

  // ── Timer ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!eventEndTime) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((new Date(eventEndTime) - Date.now()) / 1000));
      setTimeLeft(left);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [eventEndTime]);

  const formatTime = s => {
    if (s === null) return "--:--:--";
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const sc = String(s % 60).padStart(2, "0");
    return `${h}:${m}:${sc}`;
  };

  // ── Toast helper ──────────────────────────────────────────────────────────
  const toast = (text, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, text, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000);
  };

  // ── Load data ─────────────────────────────────────────────────────────────
  const loadPRs = useCallback(() =>
    fetchAllPRs().then(data => setPrs(Array.isArray(data) ? data : [])).catch(() => {}), []);
  const loadLeaderboard = useCallback(() =>
    fetchLeaderboard().then(d => setLeaderboard(d.participants ?? [])).catch(() => {}), []);
  const loadIssues = useCallback(() =>
    fetchIssues().then(d => setIssues(d.issues ?? [])).catch(() => {}), []);
  const loadTeams = useCallback(() =>
    fetchTeams().then(setTeams).catch(() => {}), []);

  useEffect(() => { loadPRs(); loadLeaderboard(); loadIssues(); loadTeams(); }, []);

  // ── WebSocket ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let ws, retry;
    const connect = () => {
      ws = new WebSocket(API_CONFIG.WS);
      ws.onmessage = ev => {
        try {
          const msg = JSON.parse(ev.data);

          if (msg.type === "teams_online") {
            setWsCount(msg.count);
          }

          if (msg.type === "new_pr" && !isLocked) {
            setPrs(prev => {
              if (prev.find(p => p.pr_number === msg.pr?.pr_number && p.repo === msg.pr?.repo)) return prev;
              return [msg.pr, ...prev];
            });
            const notif = { id: Date.now(), text: `@${msg.pr?.github_username} opened PR: ${msg.pr?.title}`, pr: msg.pr };
            setNotifications(p => [notif, ...p.slice(0, 19)]);
            toast(`New PR: @${msg.pr?.github_username}`, "info");
          }

          if (msg.type === "status_update") {
            setPrs(prev => prev.map(p =>
              String(p.pr_number) === String(msg.prId) ? { ...p, status: msg.status } : p
            ));
          }

          if (msg.type === "ci_update") {
            setPrs(prev => prev.map(p =>
              String(p.pr_number) === String(msg.prId) ? { ...p, ci_status: msg.ci_status } : p
            ));
          }

          if (msg.type === "score_pending") {
            setPrs(prev => prev.map(p =>
              p.pr_number === msg.pr_number
                ? { ...p, pending_score: msg.score, ci_status: msg.ci_passed ? "passed" : "failed", score_approved: false }
                : p
            ));
            const notif = { id: Date.now(), text: `Score pending approval for PR #${msg.pr_number} (${msg.score} pts)`, type: "score" };
            setNotifications(p => [notif, ...p.slice(0, 19)]);
            toast(`Score ready for approval — PR #${msg.pr_number}`, "warning");
          }

          if (msg.type === "score_update") {
            setPrs(prev => prev.map(p =>
              p.pr_number === msg.pr_number ? { ...p, score: msg.final_score, score_approved: true } : p
            ));
            setLeaderboard(prev => {
              const updated = prev.map(r =>
                r.github_username === msg.github_username ? { ...r, total_score: msg.total_score } : r
              );
              updated.sort((a, b) => b.total_score - a.total_score);
              updated.forEach((r, i) => { r.rank = i + 1; });
              return [...updated];
            });
          }

          if (msg.type === "team_score_update") {
            setTeams(prev => prev.map(t =>
              t._id === msg.team_id ? { ...t, total_score: msg.total_score } : t
            ).sort((a, b) => (b.total_score ?? 0) - (a.total_score ?? 0)));
          }
        } catch {}
      };
      ws.onclose = () => { retry = setTimeout(connect, 3000); };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => { ws?.close(); clearTimeout(retry); };
  }, [isLocked]);

  // ── Approve / Reject PR ───────────────────────────────────────────────────
  const handleApprove = async (prId, comment) => {
  const pr = prs.find(p => String(p.pr_number) === String(prId));
  if (!pr) return;
  try {
    await fetch(`${API_CONFIG.BASE}/pr/${pr.repo}/${prId}/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "1",   // 👈 add this
      },
      body: JSON.stringify({ comment: comment || "" }),
    }).then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.detail || r.status);
      }
    });
    setPrs(prev => prev.map(p => String(p.pr_number) === String(prId) ? { ...p, status: "merged" } : p));
    setSelected(null);   // 👈 close AFTER success, not before
    toast("PR Approved & Merged ✓", "success");
  } catch (e) {
    toast(`Merge failed: ${e.message}`, "error");
  }
};

  const handleReject = async (prId, comment) => {
  const pr = prs.find(p => String(p.pr_number) === String(prId));
  if (!pr) return;
  try {
    await fetch(`${API_CONFIG.BASE}/pr/${pr.repo}/${prId}/reject`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "1",   // 👈 add this
      },
      body: JSON.stringify({ comment: comment || "" }),
    }).then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.detail || r.status);
      }
    });
    setPrs(prev => prev.map(p => String(p.pr_number) === String(prId) ? { ...p, status: "closed" } : p));
    setSelected(null);   // 👈 close AFTER success
    toast("PR Closed ✓", "info");
  } catch (e) {
    toast(`Close failed: ${e.message}`, "error");
  }
};
  // ── Filters ───────────────────────────────────────────────────────────────
  const filteredPRs = prs
    .filter(p => {
      if (statusFilter === "all")     return true;
      if (statusFilter === "pending") return p.ci_status === "pending";
      return p.status === statusFilter;
    })
    .filter(p => ciFilter === "all" || p.ci_status === ciFilter)
    .filter(p => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (p.github_username || "").toLowerCase().includes(q) ||
             (p.title || "").toLowerCase().includes(q) ||
             (p.team_name || "").toLowerCase().includes(q);
    });

  // ── Admin helpers ─────────────────────────────────────────────────────────
  const adminLogin = async () => {
    try {
      const cfg = await fetchAdminConfig(adminToken);
      setAdminCfg(cfg);
      if (cfg.event_end_time) setEventEndTime(cfg.event_end_time);
      setAdminAuthed(true);
      setAdminErr("");
      localStorage.setItem("adminToken", adminToken);
      fetchPendingScores(adminToken).then(setPendingScores).catch(() => {});
      fetchActivity(adminToken).then(setActivityLog).catch(() => {});
      fetchBanned(adminToken).then(setBannedList).catch(() => {});
    } catch { setAdminErr("Invalid admin token"); }
  };

  const adminSave = async () => {
    try {
      const cfg = await updateAdminConfig(adminToken, adminCfg);
      setAdminCfg(cfg);
      if (cfg.event_end_time) setEventEndTime(cfg.event_end_time);
      setAdminMsg("Saved!"); setTimeout(() => setAdminMsg(""), 3000);
    } catch { setAdminErr("Save failed"); }
  };

  const handleApproveScore = async (repo, prNumber) => {
    try {
      await approveScore(repo, prNumber, adminToken);
      setPendingScores(prev => prev.filter(s => !(s.repo === repo && s.pr_number === prNumber)));
      setPrs(prev => prev.map(p =>
        p.repo === repo && p.pr_number === prNumber ? { ...p, score_approved: true } : p
      ));
      toast("Score approved!", "success");
      loadLeaderboard();
    } catch (e) { toast(`Error: ${e.message}`, "error"); }
  };

  const handleRejectScore = async (repo, prNumber) => {
    try {
      await rejectScore(repo, prNumber, adminToken);
      setPendingScores(prev => prev.filter(s => !(s.repo === repo && s.pr_number === prNumber)));
      toast("Score rejected", "info");
    } catch (e) { toast(`Error: ${e.message}`, "error"); }
  };

  const handleDeleteIssue = async (repo, issueNumber) => {
    if (!confirm(`Delete issue #${issueNumber}?`)) return;
    try {
      await deleteIssue(repo, issueNumber, adminToken);
      setIssues(prev => prev.filter(i => !(i.repo === repo && i.issue_number === issueNumber)));
      toast("Issue deleted", "info");
    } catch (e) { toast(`Error: ${e.message}`, "error"); }
  };

  const handleCreateTeam = async () => {
    if (!newTeam.name) return;
    try {
      await createTeam({
        team_name: newTeam.name,
        members: newTeam.members.split(",").map(m => m.trim()).filter(Boolean),
      }, adminToken);
      setNewTeam({ name: "", members: "" });
      loadTeams();
      toast("Team created!", "success");
    } catch (e) { toast(`Error: ${e.message}`, "error"); }
  };

  const handleDeleteTeam = async (id) => {
    if (!confirm("Delete this team?")) return;
    try { await deleteTeam(id, adminToken); loadTeams(); toast("Team deleted", "info"); }
    catch (e) { toast(`Error: ${e.message}`, "error"); }
  };

  const handleBan = async () => {
    if (!banInput.trim()) return;
    try {
      await banUser(banInput.trim(), adminToken);
      fetchBanned(adminToken).then(setBannedList);
      setBanInput("");
      toast(`@${banInput} banned`, "warning");
    } catch (e) { toast(`Error: ${e.message}`, "error"); }
  };

  const handleSetTeamScore = async (teamId, replace) => {
    const edit = teamScoreEdit[teamId] || {};
    const score = Number(edit.score);
    if (!score && score !== 0) return;
    try {
      await setTeamScore(teamId, score, edit.note || "", replace, adminToken);
      setTeams(prev => prev.map(t =>
        t._id === teamId
          ? { ...t, total_score: replace ? score : (t.total_score ?? 0) + score }
          : t
      ).sort((a, b) => (b.total_score ?? 0) - (a.total_score ?? 0)));
      setTeamScoreEdit(p => ({ ...p, [teamId]: { score: "", note: "" } }));
      toast(`Team score updated!`, "success");
    } catch (e) { toast(`Error: ${e.message}`, "error"); }
  };

  const handleCreateIssue = async () => {
    if (!newIssue.issue_number || !newIssue.title) return;
    try {
      await createIssue({ ...newIssue, issue_number: Number(newIssue.issue_number) }, adminToken);
      setNewIssue({ issue_number: "", title: "", repo: "commit-conquer", points: 10, difficulty: "medium" });
      loadIssues();
      toast("Issue added!", "success");
    } catch (e) { toast(`Error: ${e.message}`, "error"); }
  };

  const unreadCount = notifications.length;

  const S = { fontSize: 13, color: "var(--text-muted)" };
  const card = { background: "var(--bg-card)", border: "1px solid var(--border-light)", borderRadius: 12, padding: 20, marginBottom: 16 };
  const inp  = { padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border-light)", fontSize: 13, width: "100%", outline: "none" };
  const btn  = (color = "#4f6ef7") => ({ padding: "8px 16px", borderRadius: 8, border: "none", background: color, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" });

  return (
    <div className="app-container">
      <div className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Commit &amp; Conquer</span>
          <button className="hamburger" onClick={() => setSidebarOpen(false)}><XIcon size={18} /></button>
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {TABS.map(({ id, icon: Icon, label }) => (
            <button key={id} onClick={() => { setCurrentView(id); setSidebarOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                background: currentView === id ? "var(--bg-card)" : "transparent",
                border: `1px solid ${currentView === id ? "var(--border-light)" : "transparent"}`,
                borderRadius: 10, cursor: "pointer", fontWeight: 600,
                color: currentView === id ? "var(--text-main)" : "var(--text-muted)", textAlign: "left", width: "100%",
              }}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="main-content">
        {/* Header */}
        <header className="main-header">
          <div className="header-left" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button className="hamburger" onClick={() => setSidebarOpen(true)}><Menu size={22} /></button>
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search..." className="header-search" />
            {currentView === "prs" && (
              <div style={{ display: "flex", gap: 4 }}>
                {["all", "open", "merged", "pending", "rejected"].map(s => (
                  <button key={s} onClick={() => setStatusFilter(s)}
                    style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid var(--border-light)", background: statusFilter === s ? "#4f6ef7" : "var(--bg-card)", color: statusFilter === s ? "#fff" : "var(--text-muted)" }}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="header-right" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 13, color: isLocked ? "#ef4444" : "var(--text-main)", display: "flex", alignItems: "center", gap: 4 }}>
              {isLocked ? <Lock size={13} /> : <Clock size={13} />}
              {isLocked ? "Closed" : formatTime(timeLeft)}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {wsCount} online
            </div>
            {/* Notification bell */}
            <div style={{ position: "relative" }}>
              <button onClick={() => setShowNotif(p => !p)}
                style={{ background: "none", border: "none", cursor: "pointer", position: "relative" }}>
                <Bell size={20} color={unreadCount > 0 ? "#4f6ef7" : "var(--text-muted)"} />
                {unreadCount > 0 && (
                  <span style={{ position: "absolute", top: -4, right: -4, background: "#ef4444", color: "#fff", borderRadius: "50%", width: 16, height: 16, fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>
              {showNotif && (
                <div style={{ position: "absolute", right: 0, top: 32, width: 320, background: "var(--bg-card)", border: "1px solid var(--border-light)", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,.15)", zIndex: 999, maxHeight: 360, overflowY: "auto" }}>
                  <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-light)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>Notifications</span>
                    <button onClick={() => { setNotifications([]); setShowNotif(false); }}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--text-muted)" }}>
                      Clear all
                    </button>
                  </div>
                  {notifications.length === 0 ? (
                    <div style={{ padding: 20, textAlign: "center", ...S }}>No notifications</div>
                  ) : notifications.map(n => (
                    <div key={n.id} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-light)", fontSize: 12, color: "var(--text-muted)", cursor: n.pr ? "pointer" : "default" }}
                      onClick={() => { if (n.pr) { setSelected(n.pr); setCurrentView("prs"); setShowNotif(false); } }}>
                      {n.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* ── Submissions ── */}
        {currentView === "prs" && (
          <PRList prs={filteredPRs} onOpen={setSelected} />
        )}

        {/* ── Leaderboard ── */}
        {currentView === "leaderboard" && (
          <div style={{ padding: "0 8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-main)" }}>Leaderboard</h2>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {["team", "individual"].map(m => (
                  <button key={m} onClick={() => setLbMode(m)}
                    style={{ padding: "7px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                      border: "1px solid var(--border-light)",
                      background: lbMode === m ? "#4f6ef7" : "var(--bg-card)",
                      color: lbMode === m ? "#fff" : "var(--text-muted)" }}>
                    {m === "team" ? "Teams" : "Individuals"}
                  </button>
                ))}
                <button onClick={() => { loadLeaderboard(); loadTeams(); }}
                  style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border-light)", background: "var(--bg-card)", cursor: "pointer", fontSize: 12, color: "var(--text-main)" }}>
                  <RefreshCw size={13} style={{ display: "inline", marginRight: 4 }} />Refresh
                </button>
              </div>
            </div>

            {/* Team leaderboard */}
            {lbMode === "team" && (
              <>
                {/* Inline admin login for score editing */}
                {!adminAuthed && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, background: "var(--bg-card)", border: "1px solid var(--border-light)", borderRadius: 10, padding: "10px 14px" }}>
                    <Lock size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                    <input
                      type="password"
                      placeholder="Admin token to edit scores"
                      value={adminToken}
                      onChange={e => setAdminToken(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && adminLogin()}
                      style={{ flex: 1, padding: "6px 10px", borderRadius: 7, border: "1px solid var(--border-light)", fontSize: 13, outline: "none" }}
                    />
                    <button onClick={adminLogin}
                      style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: "#4f6ef7", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      Unlock
                    </button>
                  </div>
                )}
                {adminAuthed && (
                  <div style={{ fontSize: 12, color: "#22c55e", marginBottom: 10, paddingLeft: 2, fontWeight: 600 }}>
                    Admin unlocked — set scores below
                  </div>
                )}
                <div style={{ border: "1px solid var(--border-light)", borderRadius: 12, overflow: "hidden", background: "var(--bg-card)" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border-light)", background: "var(--bg-main)" }}>
                        {["#", "Team", "Members", "Score", ...(adminAuthed ? ["Set Score"] : [])].map(h => (
                          <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...teams].sort((a, b) => (b.total_score ?? 0) - (a.total_score ?? 0)).length === 0 ? (
                        <tr><td colSpan={adminAuthed ? 5 : 4} style={{ padding: 40, textAlign: "center", ...S }}>No teams yet.</td></tr>
                      ) : [...teams].sort((a, b) => (b.total_score ?? 0) - (a.total_score ?? 0)).map((t, i) => (
                        <tr key={t._id} style={{ borderBottom: "1px solid var(--border-light)" }}>
                          <td style={{ padding: "14px 14px", fontWeight: 700, fontSize: 16 }}>
                            {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                          </td>
                          <td style={{ padding: "14px 14px", fontWeight: 700, fontSize: 15, color: "var(--text-main)" }}>{t.team_name}</td>
                          <td style={{ padding: "14px 14px" }}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                              {(t.members || []).map(m => (
                                <span key={m} style={{ background: "var(--bg-main)", border: "1px solid var(--border-light)", borderRadius: 6, padding: "2px 7px", fontSize: 11, color: "var(--text-muted)" }}>@{m}</span>
                              ))}
                            </div>
                          </td>
                          <td style={{ padding: "14px 14px", fontWeight: 900, fontSize: 20, color: "#4f6ef7" }}>{t.total_score ?? 0}</td>
                          {adminAuthed && (
                            <td style={{ padding: "10px 14px" }}>
                              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                <input
                                  type="number"
                                  placeholder="pts"
                                  value={(teamScoreEdit[t._id] || {}).score ?? ""}
                                  onChange={e => setTeamScoreEdit(p => ({ ...p, [t._id]: { ...(p[t._id] || {}), score: e.target.value } }))}
                                  style={{ width: 70, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border-light)", fontSize: 13, outline: "none" }}
                                />
                                <button onClick={() => handleSetTeamScore(t._id, true)}
                                  style={{ padding: "5px 10px", borderRadius: 6, border: "none", background: "#4f6ef7", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                                  Set
                                </button>
                                <button onClick={() => handleSetTeamScore(t._id, false)}
                                  style={{ padding: "5px 10px", borderRadius: 6, border: "none", background: "#22c55e", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                                  +Add
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Individual leaderboard */}
            {lbMode === "individual" && (
              <div style={{ border: "1px solid var(--border-light)", borderRadius: 12, overflow: "hidden", background: "var(--bg-card)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-light)", background: "var(--bg-main)" }}>
                      {["#", "Participant", "Team", "Total", "Pipeline", "Bonus", "PRs", "Merged", "Issues"].map(h => (
                        <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.length === 0 ? (
                      <tr><td colSpan={9} style={{ padding: 40, textAlign: "center", ...S }}>No data yet. Waiting for participants...</td></tr>
                    ) : leaderboard.map((p, i) => (
                      <tr key={p.github_username} style={{ borderBottom: "1px solid var(--border-light)" }}>
                        <td style={{ padding: "12px 14px", fontWeight: 700 }}>
                          {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${p.rank}`}
                        </td>
                        <td style={{ padding: "12px 14px", fontWeight: 600 }}>@{p.github_username}</td>
                        <td style={{ padding: "12px 14px", ...S }}>{p.team_name || "—"}</td>
                        <td style={{ padding: "12px 14px", fontWeight: 800, fontSize: 15 }}>{p.total_score}</td>
                        <td style={{ padding: "12px 14px", ...S }}>{p.pipeline_score ?? 0}</td>
                        <td style={{ padding: "12px 14px", color: "#22c55e" }}>+{p.bonus_score ?? 0}</td>
                        <td style={{ padding: "12px 14px", ...S }}>{p.total_prs ?? 0}</td>
                        <td style={{ padding: "12px 14px", color: "#a855f7" }}>{p.merged_prs ?? 0}</td>
                        <td style={{ padding: "12px 14px", ...S }}>{p.issues_solved ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Issues ── */}
        {currentView === "issues" && (
          <div style={{ padding: "0 8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-main)" }}>Issues</h2>
              <button onClick={loadIssues} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border-light)", background: "var(--bg-card)", cursor: "pointer", fontSize: 12 }}>
                <RefreshCw size={13} style={{ display: "inline", marginRight: 4 }} />Refresh
              </button>
            </div>
            <div style={{ border: "1px solid var(--border-light)", borderRadius: 12, overflow: "hidden", background: "var(--bg-card)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-light)", background: "var(--bg-main)" }}>
                    {["#", "Title", "Points", "Difficulty", "Status", "Assigned", ""].map(h => (
                      <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {issues.length === 0 ? (
                    <tr><td colSpan={7} style={{ padding: 32, textAlign: "center", ...S }}>No issues. They sync from GitHub or add below.</td></tr>
                  ) : issues.map(issue => (
                    <tr key={`${issue.repo}-${issue.issue_number}`} style={{ borderBottom: "1px solid var(--border-light)" }}>
                      <td style={{ padding: "12px 14px", fontFamily: "monospace", ...S }}>#{issue.issue_number}</td>
                      <td style={{ padding: "12px 14px", fontWeight: 600, color: "var(--text-main)" }}>{issue.title}</td>
                      <td style={{ padding: "12px 14px", fontWeight: 700, color: "#4f6ef7" }}>{issue.points}</td>
                      <td style={{ padding: "12px 14px" }}>
                        <span style={{ padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600,
                          background: issue.difficulty === "easy" ? "#dcfce7" : issue.difficulty === "hard" ? "#fee2e2" : "#fef9c3",
                          color: issue.difficulty === "easy" ? "#166534" : issue.difficulty === "hard" ? "#991b1b" : "#854d0e" }}>
                          {issue.difficulty}
                        </span>
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        <span style={{ padding: "2px 8px", borderRadius: 12, fontSize: 11, background: issue.status === "closed" ? "#ede9fe" : "#dbeafe", color: issue.status === "closed" ? "#6d28d9" : "#1e40af" }}>
                          {issue.status}
                        </span>
                      </td>
                      <td style={{ padding: "12px 14px", ...S }}>{issue.assigned_to || "—"}</td>
                      <td style={{ padding: "12px 14px" }}>
                        
                          <button onClick={() => handleDeleteIssue(issue.repo, issue.issue_number)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", padding: 4 }}>
                            <Trash2 size={14} />
                          </button>
                      
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Admin ── */}
        {currentView === "admin" && (
          <div style={{ maxWidth: 680, padding: "0 8px" }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, color: "var(--text-main)" }}>Admin</h2>

            {!adminAuthed ? (
              <div style={card}>
                <div style={{ ...S, marginBottom: 10 }}>Enter admin token</div>
                <input type="password" value={adminToken} onChange={e => setAdminToken(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && adminLogin()}
                  placeholder="Admin token" style={{ ...inp, marginBottom: 10 }} />
                {adminErr && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 8 }}>{adminErr}</div>}
                <button onClick={adminLogin} style={btn()}>Login</button>
              </div>
            ) : (
              <>
                {adminMsg && <div style={{ background: "#dcfce7", color: "#166534", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{adminMsg}</div>}

                {/* Admin tabs */}
                <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
                  {[
                    { id: "config",   label: "Config"     },
                    { id: "scores",   label: `Pending (${pendingScores.length})` },
                    { id: "teams",    label: "Teams"      },
                    { id: "issues",   label: "Add Issues" },
                    { id: "security", label: "Security"   },
                    { id: "activity", label: "Activity"   },
                  ].map(t => (
                    <button key={t.id} onClick={() => setAdminTab(t.id)}
                      style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                        border: "1px solid var(--border-light)",
                        background: adminTab === t.id ? "#4f6ef7" : "var(--bg-card)",
                        color: adminTab === t.id ? "#fff" : "var(--text-muted)" }}>
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* Config tab */}
                {adminTab === "config" && (
                  <div style={card}>
                    <div style={{ fontWeight: 700, marginBottom: 16 }}>Scoring Configuration</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
                      {[
                        { key: "pr_opened",       label: "PR Opened"   },
                        { key: "pipeline_passed", label: "CI Passed"   },
                        { key: "merged_bonus",    label: "Merge Bonus" },
                      ].map(({ key, label }) => (
                        <div key={key}>
                          <label style={{ ...S, display: "block", marginBottom: 4 }}>{label}</label>
                          <input type="number" value={adminCfg[key] ?? 0}
                            onChange={e => setAdminCfg(c => ({ ...c, [key]: Number(e.target.value) }))}
                            style={{ ...inp, fontFamily: "monospace" }} />
                        </div>
                      ))}
                    </div>
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ ...S, display: "block", marginBottom: 4 }}>Event End Time (ISO — sets the countdown timer)</label>
                      <input type="datetime-local" value={adminCfg.event_end_time ? adminCfg.event_end_time.slice(0, 16) : ""}
                        onChange={e => setAdminCfg(c => ({ ...c, event_end_time: new Date(e.target.value).toISOString() }))}
                        style={{ ...inp }} />
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={adminSave} style={btn()}><Save size={13} style={{ display: "inline", marginRight: 4 }} />Save Config</button>
                      <button onClick={() => recalculateAll(adminToken).then(() => { loadLeaderboard(); toast("Recalculated!", "success"); })} style={btn("#6366f1")}>
                        <RefreshCw size={13} style={{ display: "inline", marginRight: 4 }} />Recalculate All
                      </button>
                      <button onClick={() => exportCSV(adminToken)} style={btn("#22c55e")}>
                        <Download size={13} style={{ display: "inline", marginRight: 4 }} />Export CSV
                      </button>
                    </div>
                  </div>
                )}

                {/* Pending scores tab */}
                {adminTab === "scores" && (
                  <div style={card}>
                    <div style={{ fontWeight: 700, marginBottom: 14 }}>Pending Score Approvals</div>
                    <div style={{ ...S, marginBottom: 16 }}>Scores from CI pipeline. Review and approve or reject each one.</div>
                    {pendingScores.length === 0 ? (
                      <div style={{ ...S, padding: "20px 0" }}>No pending scores.</div>
                    ) : pendingScores.map(s => (
                      <div key={`${s.repo}-${s.pr_number}`}
                        style={{ background: "var(--bg-main)", borderRadius: 10, padding: 14, marginBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>PR #{s.pr_number} — @{s.github_username}</div>
                            <div style={{ ...S, marginTop: 4 }}>
                              Score: <strong>{s.final_score}/90</strong> ·
                              Tests: {s.tests_passed ? "✅" : "❌"} ·
                              {s.is_duplicate_issue && <span style={{ color: "#f59e0b", marginLeft: 4 }}> Duplicate issue PR</span>}
                            </div>
                            {s.ai_review?.summary && (
                              <div style={{ ...S, marginTop: 6, fontStyle: "italic", fontSize: 12 }}>
                                AI: {s.ai_review.summary} (Manual: {s.ai_review.manual_score_suggestion}/10)
                              </div>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => handleApproveScore(s.repo, s.pr_number)}
                              style={{ ...btn("#22c55e"), padding: "6px 12px", fontSize: 12 }}>Approve</button>
                            <button onClick={() => handleRejectScore(s.repo, s.pr_number)}
                              style={{ ...btn("#ef4444"), padding: "6px 12px", fontSize: 12 }}>Reject</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Teams tab */}
                {adminTab === "teams" && (
                  <div style={card}>
                    <div style={{ fontWeight: 700, marginBottom: 14 }}>Team Management</div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                      <input placeholder="Team name" value={newTeam.name}
                        onChange={e => setNewTeam(p => ({ ...p, name: e.target.value }))}
                        style={{ ...inp, flex: 1 }} />
                      <input placeholder="Members (comma separated usernames)"
                        value={newTeam.members}
                        onChange={e => setNewTeam(p => ({ ...p, members: e.target.value }))}
                        style={{ ...inp, flex: 2 }} />
                      <button onClick={handleCreateTeam} style={btn()}><Plus size={14} /></button>
                    </div>
                    {teams.length === 0 ? (
                      <div style={{ ...S }}>No teams yet.</div>
                    ) : teams.map(team => (
                      <div key={team._id} style={{ background: "var(--bg-main)", borderRadius: 10, padding: 14, marginBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, marginBottom: 6 }}>{team.team_name}</div>
                            <div style={{ ...S, marginBottom: 8 }}>
                              {(team.members || []).map(m => (
                                <span key={m} style={{ background: "var(--bg-card)", border: "1px solid var(--border-light)", borderRadius: 6, padding: "2px 8px", fontSize: 11, marginRight: 4 }}>
                                  @{m}
                                  <button onClick={() => removeTeamMember(team._id, m, adminToken).then(loadTeams)}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", marginLeft: 4, fontSize: 11 }}>×</button>
                                </span>
                              ))}
                            </div>
                            {/* Manual score controls */}
                            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                              <input
                                type="number"
                                placeholder="Score"
                                value={(teamScoreEdit[team._id] || {}).score ?? ""}
                                onChange={e => setTeamScoreEdit(p => ({ ...p, [team._id]: { ...(p[team._id] || {}), score: e.target.value } }))}
                                style={{ ...inp, width: 90, flex: "none" }}
                              />
                              <input
                                placeholder="Note (optional)"
                                value={(teamScoreEdit[team._id] || {}).note ?? ""}
                                onChange={e => setTeamScoreEdit(p => ({ ...p, [team._id]: { ...(p[team._id] || {}), note: e.target.value } }))}
                                style={{ ...inp, flex: 1, minWidth: 120 }}
                              />
                              <button onClick={() => handleSetTeamScore(team._id, true)}
                                style={{ ...btn("#4f6ef7"), padding: "7px 12px", fontSize: 12, whiteSpace: "nowrap" }}>
                                Set Score
                              </button>
                              <button onClick={() => handleSetTeamScore(team._id, false)}
                                style={{ ...btn("#22c55e"), padding: "7px 12px", fontSize: 12, whiteSpace: "nowrap" }}>
                                + Add
                              </button>
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: 12 }}>
                            <span style={{ fontWeight: 700, color: "#4f6ef7", fontSize: 18 }}>{team.total_score ?? 0} pts</span>
                            <button onClick={() => handleDeleteTeam(team._id)}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444" }}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Issues tab */}
                {adminTab === "issues" && (
                  <div style={card}>
                    <div style={{ fontWeight: 700, marginBottom: 14 }}>Add Issue Manually</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                      <input placeholder="Issue number (e.g. 5)" type="number" value={newIssue.issue_number}
                        onChange={e => setNewIssue(p => ({ ...p, issue_number: e.target.value }))} style={inp} />
                      <input placeholder="Title" value={newIssue.title}
                        onChange={e => setNewIssue(p => ({ ...p, title: e.target.value }))} style={inp} />
                      <input placeholder="Points" type="number" value={newIssue.points}
                        onChange={e => setNewIssue(p => ({ ...p, points: Number(e.target.value) }))} style={inp} />
                      <select value={newIssue.difficulty} onChange={e => setNewIssue(p => ({ ...p, difficulty: e.target.value }))} style={{ ...inp }}>
                        <option value="easy">Easy (10 pts)</option>
                        <option value="medium">Medium (20 pts)</option>
                        <option value="hard">Hard (30 pts)</option>
                      </select>
                    </div>
                    <button onClick={handleCreateIssue} style={btn()}><Plus size={13} style={{ display: "inline", marginRight: 4 }} />Add Issue</button>
                  </div>
                )}

                {/* Security tab */}
                {adminTab === "security" && (
                  <div style={card}>
                    <div style={{ fontWeight: 700, marginBottom: 14 }}>Ban / Unban Participants</div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                      <input placeholder="GitHub username to ban" value={banInput}
                        onChange={e => setBanInput(e.target.value)} style={{ ...inp, flex: 1 }} />
                      <button onClick={handleBan} style={btn("#ef4444")}>Ban</button>
                    </div>
                    {bannedList.length > 0 && (
                      <div>
                        <div style={{ ...S, marginBottom: 8 }}>Banned users:</div>
                        {bannedList.map(b => (
                          <div key={b.username} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-light)" }}>
                            <span style={{ fontSize: 13 }}>@{b.username}</span>
                            <button onClick={() => unbanUser(b.username, adminToken).then(() => fetchBanned(adminToken).then(setBannedList))}
                              style={{ background: "none", border: "none", cursor: "pointer", ...S, fontSize: 12 }}>Unban</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Activity tab */}
                {adminTab === "activity" && (
                  <div style={card}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                      <div style={{ fontWeight: 700 }}>Activity Log</div>
                      <button onClick={() => fetchActivity(adminToken).then(setActivityLog)} style={{ background: "none", border: "none", cursor: "pointer", ...S }}>
                        <RefreshCw size={13} />
                      </button>
                    </div>
                    {activityLog.length === 0 ? (
                      <div style={S}>No activity yet.</div>
                    ) : activityLog.map((a, i) => (
                      <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--border-light)", fontSize: 12 }}>
                        <span style={{ color: "#4f6ef7", fontWeight: 600 }}>{a.action}</span>
                        <span style={{ ...S, marginLeft: 8 }}>{a.detail}</span>
                        <span style={{ ...S, float: "right" }}>{new Date(a.created_at).toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>

      {selected && (
        <PRModal pr={selected} onClose={() => setSelected(null)}
          onApprove={handleApprove} onReject={handleReject} isLocked={isLocked} adminToken={adminToken} />
      )}

      {/* Toasts */}
      <div style={{ position: "fixed", bottom: 24, left: 24, zIndex: 9999, display: "flex", flexDirection: "column-reverse", gap: 8 }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: t.type === "error" ? "#ef4444" : t.type === "success" ? "#22c55e" : t.type === "warning" ? "#f59e0b" : "#111",
            color: "#fff", padding: "12px 18px", borderRadius: 10, fontSize: 13, boxShadow: "0 4px 12px rgba(0,0,0,.2)",
            animation: "fadeIn 0.2s ease",
          }}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}