const timeAgo = ts => {
  if (!ts) return "—";
  const m = Math.floor((Date.now() - new Date(ts)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
};

const CI = {
  pending: { bg: "#fef9c3", color: "#854d0e", label: "Pending" },
  running: { bg: "#dbeafe", color: "#1e40af", label: "Running" },
  passed:  { bg: "#dcfce7", color: "#166534", label: "Passed"  },
  failed:  { bg: "#fee2e2", color: "#991b1b", label: "Failed"  },
};
const ST = {
  open:     { bg: "#dbeafe", color: "#1e40af" },
  merged:   { bg: "#ede9fe", color: "#6d28d9" },
  rejected: { bg: "#fee2e2", color: "#991b1b" },
  closed:   { bg: "#f1f5f9", color: "#475569" },
};

export default function PRList({ prs = [], onOpen }) {
  if (prs.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13,
        border: "1px solid var(--border-light)", borderRadius: 12, background: "var(--bg-card)" }}>
        No submissions yet. Raise a PR in the participant repo to see it here.
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid var(--border-light)", borderRadius: 12, overflow: "hidden", background: "var(--bg-card)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border-light)", background: "var(--bg-main)" }}>
            {["PR", "Participant", "Team", "Issue", "Status", "CI", "Score", "Bonus", "Approval", "Time"].map(h => (
              <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11,
                fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {prs.map(pr => {
            const prNum  = pr.pr_number ?? pr.id;
            const status = pr.status   ?? "open";
            const ci     = pr.ci_status ?? "pending";
            const sb     = ST[status]  || ST.open;
            const cb     = CI[ci]      || CI.pending;
            const hasPending = pr.pending_score != null && !pr.score_approved;

            return (
              <tr key={`${pr.repo}-${prNum}`} onClick={() => onOpen(pr)}
                style={{ borderBottom: "1px solid var(--border-light)", cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--bg-main)"}
                onMouseLeave={e => e.currentTarget.style.background = ""}>

                <td style={{ padding: "12px 14px" }}>
                  <div style={{ fontWeight: 600, color: "var(--text-main)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {pr.title || "Untitled PR"}
                    {pr.is_duplicate_issue && <span title="Same issue as another team PR" style={{ marginLeft: 4, color: "#f59e0b", fontSize: 10 }}>DUP</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace", marginTop: 2 }}>
                    {pr.repo}#{prNum}
                  </div>
                </td>

                <td style={{ padding: "12px 14px", fontWeight: 600, color: "var(--text-main)", whiteSpace: "nowrap" }}>
                  @{pr.github_username ?? pr.team ?? "?"}
                </td>

                <td style={{ padding: "12px 14px", color: "var(--text-muted)", fontSize: 12 }}>
                  {pr.team_name || "—"}
                </td>

                <td style={{ padding: "12px 14px", color: "var(--text-muted)", fontSize: 12 }}>
                  {pr.issue_number
                    ? <span title={pr.issue_title || ""}># {pr.issue_number}{pr.issue_title ? ` — ${pr.issue_title.slice(0, 20)}${pr.issue_title.length > 20 ? "…" : ""}` : ""}</span>
                    : "—"}
                </td>

                <td style={{ padding: "12px 14px" }}>
                  <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: sb.bg, color: sb.color }}>
                    {status}
                  </span>
                </td>

                <td style={{ padding: "12px 14px" }}>
                  <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: cb.bg, color: cb.color }}>
                    {cb.label}
                  </span>
                </td>

                <td style={{ padding: "12px 14px", fontWeight: 800, fontSize: 15, color: pr.score_approved ? "var(--text-main)" : "var(--text-muted)" }}>
                  {pr.score_approved ? pr.score ?? 0 : (hasPending ? `~${pr.pending_score}` : "—")}
                </td>

                <td style={{ padding: "12px 14px", color: "#16a34a", fontWeight: 600 }}>
                  +{pr.bonus_score ?? 0}
                </td>

                <td style={{ padding: "12px 14px" }}>
                  {pr.score_approved ? (
                    <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 600 }}>✓ Approved</span>
                  ) : hasPending ? (
                    <span style={{ fontSize: 11, color: "#f59e0b", fontWeight: 600 }}>⏳ Pending</span>
                  ) : (
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>—</span>
                  )}
                </td>

                <td style={{ padding: "12px 14px", color: "var(--text-muted)", fontSize: 12 }}>
                  {timeAgo(pr.created_at ?? pr.timestamp)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
