import { useState, useEffect } from "react";
import { X, Loader } from "lucide-react";
import { API_CONFIG } from "../services/api";

export default function PRModal({
  pr,
  onClose,
  onApprove,
  onReject,
  isLocked,
}) {
  const [comment, setComment] = useState("");
  const [copied, setCopied] = useState(false);
  const [diffLines, setDiffLines] = useState([]);
  const [loadingDiff, setLoadingDiff] = useState(true);
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);
  useEffect(() => {
    if (!pr) return;
    
    const fetchDiff = async () => {
      try {
        setLoadingDiff(true);
        const res = await fetch(`${API_CONFIG.BASE}/pr/${pr.repo}/${pr.id}`);
        
        if (res.ok) {
          const data = await res.json();
          const lines = data.diff.split('\n').map((text, idx) => {
            let type = 'normal';
            if (text.startsWith('+')) type = 'add';
            else if (text.startsWith('-')) type = 'remove';
            return { num: idx + 1, type, text };
          });
          setDiffLines(lines);
        } else {
          setDiffLines([{ num: 1, type: "normal", text: "No code changes detected or error fetching diff." }]);
        }
      } catch (err) {
        setDiffLines([{ num: 1, type: "remove", text: "Failed to connect to backend API." }]);
      } finally {
        setLoadingDiff(false);
      }
    };

    fetchDiff();
  }, [pr]);

  if (!pr) return null;

  const handleCopyAdded = async () => {
    const finalCode = diffLines
      .filter(line => line.type !== 'remove')
      .map(line => {
        if (line.type === 'add') {
          return line.text.replace(/^\+\s?/, '');
        }
        return line.text;
      })
      .join('\n');

    try {
      await navigator.clipboard.writeText(finalCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed', err);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          <X size={18} />
        </button>
        <div className="modal-left">
          <div>
            <div className="diff-header">
              <div>
                <div style={{ fontSize: '15px', fontWeight: '500', color: 'var(--text-main)' }}>
                  {pr.title}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Issue #{pr.id} • Repo: {pr.repo}
                </div>
              </div>
            </div>

            <div className="diff-viewer">
              {loadingDiff ? (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', color: 'var(--text-muted)' }}>
                  <Loader className="animate-spin" size={16} /> Fetching live code from GitHub...
                </div>
              ) : (
                diffLines.map((line, idx) => (
                  <div key={idx} className={`diff-line ${line.type}`}>
                    <div className="diff-line-num">{line.num}</div>
                    <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line.text}</div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div style={{ padding: '0 24px 24px 24px', marginTop: 'auto' }}>
            <button
              className={`btn-copy-left ${copied ? "copied" : ""}`}
              onClick={handleCopyAdded}
              disabled={loadingDiff}
            >
              {copied ? "✓ Copied" : "Copy Added Changes"}
            </button>
          </div>
        </div>
        
        <div className="modal-right">
          <div className="eval-section">
            <span className="eval-label">Team Info</span>
            <div style={{ fontSize: "18px", fontWeight: "600", marginBottom: "4px" }}>
              {pr.team}
            </div>
          </div>

          <div className="eval-section" style={{ flexGrow: 1 }}>
            <span className="eval-label">Judge Comments (Optional)</span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Leave a note before resolving..."
              style={{
                width: "100%", height: "100px", padding: "12px",
                borderRadius: "12px", border: "1px solid var(--border-light)",
                fontSize: "13px", fontFamily: "inherit", resize: "none", outline: "none"
              }}
            />
          </div>

          <div className="btn-group">
            <button
              className="btn-reject"
              onClick={() => onReject(pr.id, comment)}
              disabled={pr.status !== "open" || isLocked}
            >
              Reject
            </button>
            <button
              className="btn-approve"
              onClick={() => onApprove(pr.id, comment)}
              disabled={pr.status !== "open" || isLocked}
            >
              {isLocked ? "Submissions Locked" : pr.status === "open" ? "Approve PR" : "Resolved"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}