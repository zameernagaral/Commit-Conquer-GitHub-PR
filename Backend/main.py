from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from typing import List

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            await connection.send_json(message)

manager = ConnectionManager()
@app.get("/api/repos")
async def get_repos():
    return {"repos": ["commit-conquer"]}

@app.get("/api/prs")
async def get_prs(repo: str = None):
    return [
        {
            "id": "104", 
            "team": "Team 49", 
            "title": "Fixed component rendering bug", 
            "status": "open"
        }
    ]

@app.get("/api/pr/{repo}/{pr_number}")
async def get_pr_diff(repo: str, pr_number: str):
    return {
        "repo": repo, 
        "pr_number": pr_number, 
        "diff": "+ const score = data.points;\n- let score = data.points;"
    }

@app.post("/api/pr/{repo}/{pr_number}/approve")
async def approve_pr(repo: str, pr_number: str):
    await manager.broadcast({
        "type": "status_update",
        "prId": pr_number,
        "status": "merged"
    })
    return {"message": f"PR {pr_number} approved and merged"}

@app.post("/api/pr/{repo}/{pr_number}/reject")
async def reject_pr(repo: str, pr_number: str):
    await manager.broadcast({
        "type": "status_update",
        "prId": pr_number,
        "status": "rejected"
    })
    return {"message": f"PR {pr_number} rejected"}
@app.websocket("/api/live")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        await manager.broadcast({
            "type": "teams_online",
            "count": len(manager.active_connections)
        })
        while True:
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        await manager.broadcast({
            "type": "teams_online",
            "count": len(manager.active_connections)
        })