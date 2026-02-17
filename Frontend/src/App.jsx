import { useEffect, useState, useCallback } from 'react';
import './App.css';
import PRList from './components/PRList';
import PRModal from './components/PRModal';
import NotificationBell from './components/NotificationBell';
import { API_CONFIG, fetchAllPRs } from './services/api';
import { Check, Ban, Lock, Clock, ChevronsLeftRightEllipsis } from 'lucide-react';

export default function App() {
  const [prs, setPrs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [teamsOnline, setTeamsOnline] = useState(23);
  const [notifications, setNotifications] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [timeLeft, setTimeLeft] = useState(2 * 3600 + 14 * 60 + 23); 
  const isLocked = timeLeft <= 0;

  useEffect(() => {
    const timer = setInterval(() => setTimeLeft(prev => (prev > 0 ? prev - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const loadData = useCallback(() => { fetchAllPRs().then(data => setPrs(data)); }, []);

  useEffect(() => {
    loadData();

    if (!window.__gh_ws) {
      window.__gh_ws = { socket: null, handlers: [] };
      const makeWS = () => {
        const s = new WebSocket(API_CONFIG.WS);
        s.onmessage = (ev) => {
          try { window.__gh_ws.handlers.forEach(h => h(JSON.parse(ev.data))); } catch (e) {}
        };
        window.__gh_ws.socket = s;
      };
      try { makeWS(); } catch(e) {}
    }

    const handler = (msg) => {
      if (msg.type === 'new_pr' && !isLocked) {
        setPrs(prev => [msg.pr, ...prev]);
        setNotifications(prev => [{ id: Date.now(), team: msg.pr.team, title: msg.pr.title, pr: msg.pr }, ...prev]);
        const toastId = Date.now();
        setToasts(prev => [...prev, { id: toastId, text: `${msg.pr.team} submitted a PR` }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== toastId)), 4000);

      } else if (msg.type === 'status_update') {
        setPrs(prev => prev.map(p => p.id === msg.prId ? { ...p, status: msg.status, mergedCount: msg.newCount || p.mergedCount } : p));
      } else if (msg.type === 'teams_online') {
        setTeamsOnline(msg.count);
      }
    };
    window.__gh_ws.handlers.push(handler);
    const membersList = ['AK', 'JS', 'MR', 'NK'];
    const demoInterval = setInterval(() => {
      if (!isLocked) {
        handler({
          type: 'new_pr',
          pr: { 
            id: Math.random().toString(), 
            team: `Team ${Math.floor(Math.random() * 20) + 1}`, 
            title: 'Refactored auth middleware', 
            status: 'open', 
            timestamp: Date.now(), 
            mergedCount: 0,
            members: [membersList[Math.floor(Math.random() * 4)], membersList[Math.floor(Math.random() * 4)]] // Fake members
          }
        });
      }
    }, 25000);

    return () => {
      window.__gh_ws.handlers = window.__gh_ws.handlers.filter(h => h !== handler);
      clearInterval(demoInterval);
    };
  }, [loadData, isLocked]);

  const handleApprove = async (prId, comment) => {
    setPrs(prev => prev.map(p => p.id === prId ? { ...p, status: 'merged', mergedCount: (p.mergedCount || 0) + 1 } : p));
    setSelected(null);
    const toastId = Date.now();
    setToasts(prev => [
    ...prev, 
    { 
        id: toastId, 
        text: <><Check size={16} className="inline mr-2" /> PR Approved</> 
    }
]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== toastId)), 3000);
    try { await fetch(`${API_CONFIG.BASE}/approve/${prId}`, { method: 'POST', body: JSON.stringify({ comment }) }); } catch (e) {}
  };

  const handleReject = async (prId, comment) => {
    setPrs(prev => prev.map(p => p.id === prId ? { ...p, status: 'rejected' } : p));
    setSelected(null);
    const toastId = Date.now();
    setToasts(prev => [...prev, { id: toastId, text: <><Ban size={16} className="inline mr-2" />PR Rejected</> }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== toastId)), 3000);
    try { await fetch(`${API_CONFIG.BASE}/reject/${prId}`, { method: 'POST', body: JSON.stringify({ comment }) }); } catch (e) {}
  };

  const filteredPRs = prs.filter(pr => (pr.team || '').toLowerCase().includes(searchQuery.toLowerCase()) || (pr.title || '').toLowerCase().includes(searchQuery.toLowerCase()));
  const topTeams = [...prs].filter(pr => pr.mergedCount > 0).sort((a, b) => b.mergedCount - a.mergedCount).slice(0, 5);

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="brand">Commit & Conquer</div>
        
        <div style={{ flexGrow: 1 }}>
          <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '16px' }}>Live Leaderboard</div>
          {topTeams.map((team, idx) => (
            <div key={idx} style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
                <span style={{ fontWeight: '600', color: 'var(--text-main)' }}>{team.team}</span>
                <span style={{ color: 'var(--text-main)', fontWeight: '500' }}>{team.mergedCount} merges</span>
              </div>
              <div style={{ display: 'flex' }}>
                {team.members && team.members.map((initials, i) => (
                  <div key={i} style={{ 
                    width: '20px', height: '20px', borderRadius: '12px', background: '#e0e0e0', border: '2px solid var(--bg-main)', 
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', fontWeight: '700', color: '#555', marginRight: '-6px' 
                  }}>
                    {initials}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {topTeams.length === 0 && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No merges yet</div>}
        </div>
      </aside>
      <main className="main-content">
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
          <input type="text" placeholder="Search submissions..." style={{ background: '#fff', border: '1px solid var(--border-light)', padding: '10px 16px', borderRadius: '12px', width: '300px', fontSize: '13px', outline: 'none' }} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            <div style={{ fontSize: '13px', fontWeight: '500', color: isLocked ? 'var(--status-rejected-text)' : 'var(--text-main)' }}>
              {isLocked ? (
    <>
        <Lock size={16} className="inline mr-1" /> 
        Submissions Closed
    </>
) : (
    <>
        <Clock size={16} className="inline mr-1" /> 
        Submissions close in: {formatTime(timeLeft)}
    </>
)}
            </div>
            
            <div style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-main)' }}>
             <ChevronsLeftRightEllipsis /> {teamsOnline} Teams Online
            </div>
            <NotificationBell 
              items={notifications} 
              onClear={() => setNotifications([])} 
              onClickItem={(pr) => setSelected(pr)} 
            />
          </div>
        </header>

        <PRList prs={filteredPRs} onOpen={setSelected} />
      </main>

      {selected && <PRModal pr={selected} onClose={() => setSelected(null)} onApprove={handleApprove} onReject={handleReject} isLocked={isLocked} />}
     
      <div style={{ position: 'fixed', top: '24px', right: '24px', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {toasts.map(toast => (
          <div key={toast.id} style={{ background: '#111', color: '#fff', padding: '12px 20px', borderRadius: '12px', fontSize: '13px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', animation: 'fadeIn 0.3s ease-out' }}>
            {toast.text}
          </div>
        ))}
      </div>
    </div>
  );
}