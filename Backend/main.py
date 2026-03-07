import os
import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from typing import List
from dotenv import load_dotenv
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorClient
import certifi
load_dotenv()
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
GITHUB_ORG = os.getenv("GITHUB_ORG", "CodeIO-Org")
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")

HEADERS = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept": "application/vnd.github.v3+json",
    "X-GitHub-Api-Version": "2022-11-28"
}

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = AsyncIOMotorClient(MONGO_URI, tlsCAFile=certifi.where()) 
db = client.hackathon_db
prs_collection = db.prs

class ActionPayload(BaseModel):
    comment: str = ""
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections.copy():
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)

manager = ConnectionManager()
@app.post("/api/webhook/github")
async def github_webhook(request: Request):
    payload = await request.json()
    print("🚨 INCOMING WEBHOOK! Keys:", list(payload.keys()), "| Action:", payload.get("action"))
    if "pull_request" in payload and payload.get("action") in ["opened", "reopened"]:
        pr = payload["pull_request"]
        repo_name = payload["repository"]["name"]
        
        pr_data = {
            "id": str(pr["number"]),
            "repo": repo_name,
            "team": pr["user"]["login"],
            "title": pr["title"],
            "status": "open",
            "timestamp": pr["created_at"],
            "mergedCount": 0
        }
        
        await prs_collection.update_one(
            {"id": pr_data["id"], "repo": pr_data["repo"]}, 
            {"$set": pr_data}, 
            upsert=True
        )
        await manager.broadcast({
            "type": "new_pr",
            "pr": pr_data
        })
        
    return {"status": "ok"}
@app.get("/api/repos")
async def get_repos():
    return {"repos": ["commit-conquer"]}

@app.get("/api/prs")
async def get_prs():
    cursor = prs_collection.find({}, {"_id": 0}).sort("timestamp", -1)
    formatted_prs = await cursor.to_list(length=1000) 
    return formatted_prs

@app.get("/api/pr/{repo}/{pr_number}")
async def get_pr_diff(repo: str, pr_number: str):
    url = f"https://api.github.com/repos/{GITHUB_ORG}/{repo}/pulls/{pr_number}"
    diff_headers = HEADERS.copy()
    diff_headers["Accept"] = "application/vnd.github.v3.diff"
    
    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=diff_headers)
        if response.status_code != 200:
            raise HTTPException(status_code=404, detail="Diff not found")
            
        return {
            "repo": repo, 
            "pr_number": pr_number, 
            "diff": response.text
        }

@app.post("/api/pr/{repo}/{pr_number}/approve")
async def approve_pr(repo: str, pr_number: str, payload_data: ActionPayload):
    url = f"https://api.github.com/repos/{GITHUB_ORG}/{repo}/pulls/{pr_number}/merge"
    
    payload = {
        "commit_title": f"Merged PR #{pr_number} via Evaluator",
        "commit_message": payload_data.comment, 
        "merge_method": "squash"
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.put(url, headers=HEADERS, json=payload)
        
        if response.status_code not in [200, 201]:
            raise HTTPException(status_code=response.status_code, detail="Merge failed.")
        await prs_collection.update_one(
            {"id": pr_number, "repo": repo},
            {"$set": {"status": "merged"}}
        )
            
        await manager.broadcast({
            "type": "status_update",
            "prId": pr_number,
            "status": "merged"
        })
        
        return {"message": f"PR {pr_number} approved and merged"}

@app.post("/api/pr/{repo}/{pr_number}/reject")
async def reject_pr(repo: str, pr_number: str, payload_data: ActionPayload):
    url = f"https://api.github.com/repos/{GITHUB_ORG}/{repo}/pulls/{pr_number}"
    
    payload = {"state": "closed", "body": payload_data.comment}
    
    async with httpx.AsyncClient() as client:
        response = await client.patch(url, headers=HEADERS, json=payload)
        
        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail="Failed to close PR")
        await prs_collection.update_one(
            {"id": pr_number, "repo": repo},
            {"$set": {"status": "rejected"}}
        )
            
        await manager.broadcast({
            "type": "status_update",
            "prId": pr_number,
            "status": "rejected"
        })
        
        return {"message": f"PR {pr_number} rejected and closed"}

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