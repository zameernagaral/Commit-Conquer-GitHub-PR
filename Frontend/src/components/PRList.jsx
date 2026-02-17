
const getTimeAgo = (timestamp) => {
  if (!timestamp) return 'Just now';
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
};

export default function PRList({ prs = [], onOpen }) {
  if (prs.length === 0) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', border: '1px solid var(--border-light)', borderRadius: '12px', background: 'var(--bg-card)' }}>No submissions found.</div>;
  }

  return (
    <ul className="pr-list">
      {prs.map(pr => (
        <li key={pr.id} className="pr-item" onClick={() => onOpen(pr)}>
          <div className="pr-team">{pr.team || 'Unknown Team'}</div>
          <div className="pr-title">{pr.title || 'Untitled Pull Request'}</div>
          <div className="pr-issue">#{pr.id ? pr.id.toString().substring(0, 4) : '891'}</div>
          <div className="pr-time">{getTimeAgo(pr.timestamp)}</div>
          <div style={{ textAlign: 'right' }}>
            <span className={`status-badge status-${pr.status || 'open'}`}>
              {pr.status === 'open' ? 'Pending' : pr.status}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}