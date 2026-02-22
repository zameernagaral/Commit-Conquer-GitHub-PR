import { useState, useEffect, useRef } from "react";
import { Bell } from "lucide-react";

export default function NotificationBell({ items = [], onClear, onClickItem }) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef(null);
  const audioRef = useRef(null);
  const prevCountRef = useRef(items.length);

  useEffect(() => {
    if (items.length > prevCountRef.current) {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {});
      }
    }
    prevCountRef.current = items.length;
  }, [items]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleEsc(event) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [isOpen]);

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: "none",
          border: "none",
          fontSize: "18px",
          cursor: "pointer",
          position: "relative",
          padding: "4px",
        }}
      >
        <Bell />
        {items.length > 0 && (
          <span
            style={{
              position: "absolute",
              top: "0",
              right: "0",
              background: "#e53935",
              color: "white",
              fontSize: "9px",
              padding: "2px 5px",
              borderRadius: "12px",
              fontWeight: "bold",
              border: "2px solid var(--bg-main)",
            }}
          >
            {items.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "40px",
            width: "min(320px, calc(100vw - 32px))",
            background: "var(--bg-card)",
            border: "1px solid var(--border-light)",
            borderRadius: "12px",
            boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
            zIndex: 2000,
            padding: "16px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
              paddingBottom: "12px",
              borderBottom: "1px solid var(--border-light)",
            }}
          >
            <span
              style={{
                fontSize: "13px",
                fontWeight: "600",
                color: "var(--text-main)",
              }}
            >
              Activity Feed
            </span>
            <button
              onClick={onClear}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                fontSize: "11px",
                cursor: "pointer",
              }}
            >
              Mark all read
            </button>
          </div>

          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              maxHeight: "300px",
              overflowY: "auto",
            }}
          >
            {items.length === 0 ? (
              <li
                style={{
                  fontSize: "12px",
                  color: "var(--text-muted)",
                  padding: "20px 0",
                  textAlign: "center",
                }}
              >
                You're all caught up.
              </li>
            ) : (
              items.map((n) => (
                <li
                  key={n.id}
                  onClick={() => {
                    onClickItem(n.pr);
                    setIsOpen(false);
                  }}
                  style={{
                    padding: "12px 8px",
                    borderBottom: "1px solid #f5f5f5",
                    cursor: "pointer",
                    transition: "background 0.2s",
                    borderRadius: "12px",
                  }}
                  onMouseOver={(e) =>
                    (e.currentTarget.style.background = "#fafafa")
                  }
                  onMouseOut={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: "600",
                      color: "var(--text-main)",
                    }}
                  >
                    {n.team}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--text-muted)",
                      marginTop: "4px",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    Opened: {n.title}
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      <audio ref={audioRef} src="/sounds/notification.mp3" preload="auto" />
    </div>
  );
}