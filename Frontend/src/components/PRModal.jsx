import { useState, useEffect } from "react";
import { X, ExternalLink, Loader, ChevronUp, ChevronDown } from "lucide-react";
import { API_CONFIG, fetchScore, approveScore, rejectScore, assignScore, fetchPRFiles, setManualScore } from "../services/api";

export default function PRModal({ pr, onClose, onApprove, onReject, isLocked, adminToken }) {
  const [comment,    setComment]    = useState("");
  const [prFiles,    setPrFiles]    = useState([]);
  const [loadDiff,   setLoadDiff]   = useState(true);
  const [diffError,  setDiffError]  = useState("");
  const [scoreData,  setScoreData]  = useState(null);
  const [pending,    setPending]    = useState(null);
  const [acting,     setActing]     = useState(false);
  const [msg,        setMsg]        = useState("");

  const [manualPts,  setManualPts]  = useState(0);
  const [manualNote, setManualNote] = useState("");
  const [addMode,    setAddMode]    = useState(false);

  const prNum = String(pr.pr_number ?? pr.id ?? "");
  const token = adminToken || localStorage.getItem("adminToken") || "";

  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  useEffect(() => {
    if (!pr) return;
    setLoadDiff(true);
    setDiffError("");
    setScoreData(null);
    setPending(null);
    setMsg("");

    fetchPRFiles(pr.repo, prNum)
      .then(data => {
        if (data.error) {
          setDiffError(data.error);
        } else if (data.files && data.files.length > 0) {
          setPrFiles(data.files);
        } else {
          setDiffError("No diff available — PR may have no file changes.");
        }
      })
      .catch(e => setDiffError(`Failed to load diff: ${e.message}`))
      .finally(() => setLoadDiff(false));

    fetchScore(pr.repo, prNum).then(setScoreData).catch(() => {});

    if (!pr.score_approved && pr.pending_score != null && token) {
      fetch(`${API_CONFIG.BASE}/scores/pending`, {
        headers: { "x-admin-token": token, "ngrok-skip-browser-warning": "1" }
      })
        .then(r => r.json())
        .then(list => {
          if (Array.isArray(list)) {
            const found = list.find(s => s.repo === pr.repo && String(s.pr_number) === prNum);
            if (found) setPending(found);
          }
        })
        .catch(() => {});
    }
  }, [pr, prNum, token]);

  const showMsg = (text, isErr = false) => {
    setMsg(isErr ? `❌ ${text}` : `✅ ${text}`);
    setTimeout(() => setMsg(""), 4000);
  };

  // ── FIX: these now properly await, surface errors, and let App handle state ──
  const handleApprove = async () => {
    if (acting) return;
    setActing(true);
    try {
      await onApprove(prNum, comment);
      // onApprove throws on failure, so if we get here it succeeded
      showMsg("PR approved and merged!");
    } catch (e) {
      showMsg(e.message || "Approve failed", true);
    } finally {
      setActing(false);
    }
  };

  const handleReject = async () => {
    if (acting) return;
    setActing(true);
    try {
      await onReject(prNum, comment);
      showMsg("PR rejected.");
    } catch (e) {
      showMsg(e.message || "Reject failed", true);
    } finally {
      setActing(false);
    }
  };

  const handleApproveScore = async () => {
    if (!token) { showMsg("Log in as admin first", true); return; }
    setActing(true);
    try {
      await approveScore(pr.repo, prNum, token);
      showMsg("Score approved and added to leaderboard!");
      setTimeout(onClose, 1500);
    } catch (e) { showMsg(e.message, true); }
    finally { setActing(false); }
  };

  const handleRejectScore = async () => {
    if (!token) return;
    setActing(true);
    try {
      await rejectScore(pr.repo, prNum, token);
      showMsg("Score rejected.");
    } catch (e) { showMsg(e.message, true); }
    finally { setActing(false); }
  };

  const handleAssignManual = async () => {
    if (!token) { showMsg("Log in as admin first", true); return; }
    if (manualPts === 0 && !addMode) { showMsg("Enter points to assign", true); return; }
    setActing(true);
    try {
      const username = pr.github_username ?? pr.team;
      if (addMode) {
        await assignScore(username, manualPts, manualNote || comment, false, token);
        showMsg(`Added ${manualPts} pts to @${username}`);
      } else {
        await setManualScore(pr.repo, prNum, manualPts, manualNote || comment, token);
        showMsg(`Set PR score to ${manualPts} pts`);
      }
      setTimeout(onClose, 1500);
    } catch (e) { showMsg(e.message, true); }
    finally { setActing(false); }
  };

  if (!pr) return null;
  const username    = pr.github_username ?? pr.team ?? "?";
  const active      = scoreData || pending;
  const hasPending  = !pr.score_approved && pr.pending_score != null;
  const isApproved  = pr.score_approved;
  const aiReview    = pending?.ai_review || scoreData?.ai_review || {};

  const S  = (extra = {}) => ({ fontSize: 12, color: "var(--text-muted)", ...extra });
  const SL = { fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 5, display: "block" };

  const isOpen = pr.status === "open";
  const canAct = isOpen && !isLocked && !acting;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}
      onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 1020, maxHeight: "94vh", display: "flex", overflow: "hidden", boxShadow: "0 24px 64px rgba(0,0,0,0.35)" }}
        onClick={e => e.stopPropagation()}>

        {/* ── LEFT: DIFF ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#111" }}>{pr.title || "PR"}</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                {pr.repo}#{prNum} · @{username}
                {pr.team_name && <span style={{ marginLeft: 6, background: "#ede9fe", color: "#6d28d9", padding: "1px 7px", borderRadius: 10, fontSize: 11 }}>{pr.team_name}</span>}
                {pr.issue_number && <span style={{ marginLeft: 6, color: "#4f6ef7" }}>Fixes #{pr.issue_number}{pr.issue_title ? ` — ${pr.issue_title}` : ""}</span>}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {pr.pr_link && (
                <a href={pr.pr_link} target="_blank" rel="noreferrer"
                  style={{ fontSize: 12, color: "#4f6ef7", display: "flex", alignItems: "center", gap: 3 }}>
                  <ExternalLink size={11} /> GitHub
                </a>
              )}
              <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}><X size={16} /></button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", background: "#0d1117" }}>
            {loadDiff ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 20, color: "#888", fontSize: 13 }}>
                <Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> Fetching diff from GitHub...
              </div>
            ) : diffError ? (
              <div style={{ padding: 20 }}>
                <div style={{ color: "#fbbf24", fontSize: 13, marginBottom: 6 }}>⚠️ {diffError}</div>
                {diffError.includes("401") && (
                  <div style={{ color: "#6b7280", fontSize: 12 }}>
                    Your GITHUB_TOKEN in Backend/.env has expired or lacks repo scope.<br />
                    Generate a new token at github.com/settings/tokens with <strong>repo</strong> scope, update .env, and restart uvicorn.
                  </div>
                )}
              </div>
            ) : prFiles.length === 0 ? (
              <div style={{ padding: 20, color: "#6b7280", fontSize: 13 }}>No file changes in this PR.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 12 }}>
                {prFiles.map(file => (
                  <div key={file.filename} style={{ border: "1px solid #374151", borderRadius: 8, overflow: "hidden", background: "#161b22" }}>
                    <div style={{ padding: "8px 12px", background: "#21262d", borderBottom: "1px solid #374151", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#c9d1d9", fontFamily: "monospace", wordBreak: "break-all" }}>
                        {file.filename}
                      </span>
                      <span style={{ fontSize: 11, color: "#8b949e", display: "flex", gap: 8 }}>
                        <span style={{ color: "#3fb950" }}>+{file.additions}</span>
                        <span style={{ color: "#f85149" }}>-{file.deletions}</span>
                      </span>
                    </div>
                    {file.patch && (
                      <div style={{ padding: "8px 0", fontFamily: "monospace", fontSize: 12, overflowX: "auto" }}>
                        {file.patch.split("\n").map((line, idx) => {
                          const type = line.startsWith("+") ? "add" : line.startsWith("-") ? "remove" : line.startsWith("@@") ? "meta" : "normal";
                          return (
                            <div key={idx} style={{
                              display: "flex", gap: 10, padding: "1px 12px",
                              background: type === "add" ? "rgba(46,160,67,0.15)" : type === "remove" ? "rgba(248,81,73,0.15)" : type === "meta" ? "rgba(56,139,253,0.1)" : "transparent",
                            }}>
                              <span style={{ whiteSpace: "pre-wrap", color: type === "add" ? "#7ee787" : type === "remove" ? "#ffa198" : type === "meta" ? "#79c0ff" : "#c9d1d9" }}>
                                {line}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {aiReview?.summary && (
            <div style={{ padding: "10px 16px", borderTop: "1px solid #e5e7eb", background: "#f8f9ff", fontSize: 12 }}>
              <span style={{ fontWeight: 700, color: "#4f6ef7", marginRight: 6 }}>🤖 Copilot:</span>
              <span style={{ color: "#374151" }}>{aiReview.summary}</span>
              {aiReview.manual_score_suggestion != null && (
                <span style={{ marginLeft: 8, background: "#dbeafe", color: "#1e40af", padding: "1px 8px", borderRadius: 10, fontWeight: 600 }}>
                  Suggests {aiReview.manual_score_suggestion}/10
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT: ACTIONS ── */}
        <div style={{ width: 290, flexShrink: 0, borderLeft: "1px solid #e5e7eb", display: "flex", flexDirection: "column", background: "#f9fafb" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>

            <div style={{ marginBottom: 14 }}>
              <span style={SL}>Participant</span>
              <div style={{ fontWeight: 800, fontSize: 17, color: "#111" }}>@{username}</div>
              {pr.team_name && <div style={{ fontSize: 12, color: "#6d28d9", marginTop: 1 }}>Team: {pr.team_name}</div>}
            </div>

            {pr.issue_number && (
              <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, marginBottom: 12 }}>
                <span style={SL}>Linked Issue</span>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#111" }}>#{pr.issue_number} {pr.issue_title ? `— ${pr.issue_title}` : ""}</div>
                {(pending?.issue_points || 0) > 0 && (
                  <div style={{ fontSize: 11, color: "#16a34a", marginTop: 3 }}>+{pending.issue_points} pts · {pending.issue_difficulty}</div>
                )}
              </div>
            )}

            {/* PR Status indicator */}
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, marginBottom: 12 }}>
              <span style={SL}>PR Status</span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{
                  padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                  background: pr.status === "open" ? "#dbeafe" : pr.status === "merged" ? "#ede9fe" : pr.status === "rejected" ? "#fee2e2" : "#f1f5f9",
                  color: pr.status === "open" ? "#1e40af" : pr.status === "merged" ? "#6d28d9" : pr.status === "rejected" ? "#991b1b" : "#475569",
                }}>
                  {pr.status ?? "open"}
                </span>
                {!isOpen && (
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>Cannot modify a {pr.status} PR</span>
                )}
              </div>
            </div>

            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <span style={SL}>Pipeline Score</span>
              {!active && !hasPending ? (
                <div style={S()}>
                  {pr.ci_status === "pending" ? "⏳ CI running..." : pr.ci_status === "passed" ? "CI passed — awaiting score" : "No score yet"}
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 26, fontWeight: 900, color: isApproved ? "#111" : "#f59e0b" }}>
                    {hasPending && !isApproved ? pr.pending_score : (active?.final_score ?? 0)}
                    <span style={{ fontSize: 12, fontWeight: 400, color: "#9ca3af" }}>/90</span>
                    {hasPending && !isApproved && <span style={{ fontSize: 11, color: "#f59e0b", marginLeft: 6 }}>⏳ pending</span>}
                    {isApproved && <span style={{ fontSize: 11, color: "#16a34a", marginLeft: 6 }}>✓</span>}
                  </div>

                  {active && (
                    <div style={{ marginTop: 8 }}>
                      {[
                        { label: "Code Quality", v: active.quality_score  ?? 0, max: 20 },
                        { label: "Frontend",     v: active.frontend_score ?? 0, max: 25 },
                        { label: "Backend",      v: active.backend_score  ?? 0, max: 25 },
                        { label: "Bundle",       v: active.bundle_score   ?? 0, max: 10 },
                      ].map(({ label, v, max }) => (
                        <div key={label} style={{ marginBottom: 4 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9ca3af", marginBottom: 2 }}>
                            <span>{label}</span><span>{v}/{max}</span>
                          </div>
                          <div style={{ height: 4, background: "#e5e7eb", borderRadius: 2 }}>
                            <div style={{ height: "100%", width: `${(v/max)*100}%`, background: "#4f6ef7", borderRadius: 2 }} />
                          </div>
                        </div>
                      ))}
                      <div style={{ fontSize: 11, marginTop: 6, color: active.tests_passed ? "#16a34a" : "#dc2626" }}>
                        {active.tests_passed ? "✅ Tests passed" : "❌ Tests failed"}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, marginBottom: 12 }}>
              <span style={SL}>Bonus Points</span>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#16a34a" }}>+{pr.bonus_score ?? 0}</div>
              <div style={S({ marginTop: 2 })}>open + pipeline + merge bonuses</div>
            </div>

            <div style={{ background: "#fff", border: "2px solid #4f6ef7", borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <span style={{ ...SL, color: "#4f6ef7" }}>Assign Points (Judge Override)</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <button onClick={() => setManualPts(p => Math.max(0, p - 5))}
                  style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #e5e7eb", background: "#f9fafb", cursor: "pointer", fontWeight: 700 }}>
                  <ChevronDown size={14} style={{ margin: "auto" }} />
                </button>
                <input type="number" value={manualPts} onChange={e => setManualPts(Number(e.target.value))}
                  style={{ flex: 1, textAlign: "center", fontSize: 22, fontWeight: 900, border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", outline: "none" }} />
                <button onClick={() => setManualPts(p => p + 5)}
                  style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #e5e7eb", background: "#f9fafb", cursor: "pointer", fontWeight: 700 }}>
                  <ChevronUp size={14} style={{ margin: "auto" }} />
                </button>
              </div>

              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                {[10, 20, 30, 50, 73, 90, 100].map(p => (
                  <button key={p} onClick={() => setManualPts(p)}
                    style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid #e5e7eb", background: manualPts === p ? "#4f6ef7" : "#f9fafb", color: manualPts === p ? "#fff" : "#374151", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                    {p}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <button onClick={() => setAddMode(false)}
                  style={{ flex: 1, padding: "5px", borderRadius: 6, border: `1px solid ${!addMode ? "#4f6ef7" : "#e5e7eb"}`, background: !addMode ? "#eff6ff" : "#f9fafb", color: !addMode ? "#4f6ef7" : "#6b7280", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                  Set Total
                </button>
                <button onClick={() => setAddMode(true)}
                  style={{ flex: 1, padding: "5px", borderRadius: 6, border: `1px solid ${addMode ? "#4f6ef7" : "#e5e7eb"}`, background: addMode ? "#eff6ff" : "#f9fafb", color: addMode ? "#4f6ef7" : "#6b7280", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                  Add Points
                </button>
              </div>

              <input placeholder="Reason / note" value={manualNote} onChange={e => setManualNote(e.target.value)}
                style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12, marginBottom: 8, boxSizing: "border-box", outline: "none" }} />

              <button onClick={handleAssignManual} disabled={acting}
                style={{ width: "100%", padding: "9px", borderRadius: 8, background: "#4f6ef7", color: "#fff", border: "none", fontWeight: 700, fontSize: 13, cursor: acting ? "wait" : "pointer" }}>
                {addMode ? `Add ${manualPts} pts to @${username}` : `Set @${username} to ${manualPts} pts`}
              </button>
            </div>

            <div style={{ marginBottom: 10 }}>
              <span style={SL}>Judge Comment</span>
              <textarea value={comment} onChange={e => setComment(e.target.value)}
                placeholder="Leave a note on the PR..."
                style={{ width: "100%", height: 60, padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12, resize: "none", fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
            </div>

            {msg && (
              <div style={{ padding: "8px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600, marginBottom: 8,
                background: msg.startsWith("❌") ? "#fee2e2" : "#dcfce7",
                color: msg.startsWith("❌") ? "#991b1b" : "#166534" }}>
                {msg}
              </div>
            )}

            {hasPending && !isApproved && (
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <button onClick={handleApproveScore} disabled={acting}
                  style={{ flex: 2, padding: "8px", borderRadius: 8, background: "#22c55e", color: "#fff", border: "none", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  ✓ Approve Score
                </button>
                <button onClick={handleRejectScore} disabled={acting}
                  style={{ flex: 1, padding: "8px", borderRadius: 8, background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
                  Reject
                </button>
              </div>
            )}
            {isApproved && <div style={{ textAlign: "center", color: "#16a34a", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>✓ Score on leaderboard</div>}
          </div>

          {/* ── Approve / Reject PR buttons ── */}
          <div style={{ padding: 14, borderTop: "1px solid #e5e7eb", display: "flex", gap: 8 }}>
            <button
              onClick={handleReject}
              disabled={!canAct}
              style={{
                flex: 1, padding: "10px", borderRadius: 10,
                background: canAct ? "#fff" : "#f9fafb",
                color: canAct ? "#dc2626" : "#9ca3af",
                border: canAct ? "1px solid #fca5a5" : "1px solid #e5e7eb",
                fontWeight: 600, cursor: canAct ? "pointer" : "not-allowed", fontSize: 13,
              }}>
              {acting ? "…" : "Reject PR"}
            </button>
            <button
              onClick={handleApprove}
              disabled={!canAct}
              style={{
                flex: 1, padding: "10px", borderRadius: 10,
                background: canAct ? "#111" : "#e5e7eb",
                color: canAct ? "#fff" : "#9ca3af",
                border: "none", fontWeight: 700,
                cursor: canAct ? "pointer" : "not-allowed", fontSize: 13,
              }}>
              {acting ? "…" : isLocked ? "🔒 Locked" : !isOpen ? pr.status : "Approve PR"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}