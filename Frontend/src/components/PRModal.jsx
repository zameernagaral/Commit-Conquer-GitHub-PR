import { useState, useEffect } from 'react';

export default function PRModal({ pr, onClose, onApprove, onReject, isLocked }) {
  const [comment, setComment] = useState('');
  
  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  if (!pr) return null;

  const simulatedDiff = [
    { num: 42, type: 'normal', text: '  function calculateScore(data) {' },
    { num: 43, type: 'remove', text: '-   let score = data.points;' },
    { num: 44, type: 'add', text: '+   const score = data.points * data.multiplier;' },
    { num: 45, type: 'add', text: '+   if (score < 0) return 0;' },
    { num: 46, type: 'normal', text: '    return score;' },
    { num: 47, type: 'normal', text: '  }' }
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-left">
          <div className="diff-header">
            <div>
              <div style={{ fontSize: '15px', fontWeight: '500', color: 'var(--text-main)' }}>{pr.title}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>Issue #{Math.floor(Math.random() * 800) + 100} • src/utils/calculator.js</div>
            </div>
          </div>
          
          <div className="diff-viewer">
            {simulatedDiff.map((line, idx) => (
              <div key={idx} className={`diff-line ${line.type}`}>
                <div className="diff-line-num">{line.num}</div>
                <div style={{ whiteSpace: 'pre' }}>{line.text}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-right">
          
          <div className="eval-section">
            <span className="eval-label">Team Info</span>
            <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '4px' }}>{pr.team}</div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Members: {pr.members ? pr.members.join(', ') : 'Hidden'}</div>
          </div>

          <div className="eval-section">
            <span className="eval-label">Automated Checks</span>
            <div className="linter-check">
              <span style={{ color: '#22863a' }}>✓</span> Linter passed
            </div>
            <div className="linter-check">
              <span style={{ color: '#22863a' }}>✓</span> Build successful
            </div>
          </div>

          <div className="eval-section" style={{ flexGrow: 1 }}>
            <span className="eval-label">Judge Comments (Optional)</span>
            <textarea 
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Leave a note before resolving..."
              style={{ width: '100%', height: '100px', padding: '12px', borderRadius: '12px', border: '1px solid var(--border-light)', fontSize: '13px', fontFamily: 'inherit', resize: 'none', outline: 'none' }}
            />
          </div>

          <div className="btn-group">
            <button 
              className="btn-reject" 
              onClick={() => onReject(pr.id, comment)}
              disabled={pr.status !== 'open' || isLocked}
            >
              Reject
            </button>
            <button 
              className="btn-approve" 
              onClick={() => onApprove(pr.id, comment)}
              disabled={pr.status !== 'open' || isLocked}
            >
              {isLocked ? 'Submissions Locked' : pr.status === 'open' ? 'Approve PR' : 'Resolved'}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}