import os, re, hmac, hashlib, csv, io
import httpx, certifi
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from contextlib import asynccontextmanager
from typing import List, Optional
from datetime import datetime, timezone
from bson import ObjectId
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

GITHUB_ORG     = os.getenv("GITHUB_ORG", "Commit-Conquer")
MONGO_URI      = os.getenv("MONGO_URI", "mongodb://localhost:27017")
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "")
ADMIN_TOKEN    = os.getenv("ADMIN_TOKEN", "admin123")

from services.github import (
    get_gh_headers,
    get_pull_diff,
    get_pull_files,
    merge_pull_request,
    close_pull_request,
    post_issue_comment,
)

# ── DB ────────────────────────────────────────────────────────────────────────
mongo_client = AsyncIOMotorClient(MONGO_URI, tlsCAFile=certifi.where())
db           = mongo_client["commit_conquer"]
prs_col      = db["prs"]
scores_col   = db["scores"]
pending_col  = db["pending_scores"]   # awaiting admin approval
parts_col    = db["participants"]
config_col   = db["config"]
teams_col    = db["teams"]
issues_col   = db["issues"]
banned_col   = db["banned"]
activity_col = db["activity"]


async def ensure_indexes():
    await prs_col.create_index([("repo", 1), ("pr_number", 1)], unique=True)
    await prs_col.create_index([("github_username", 1)])
    await prs_col.create_index([("team_id", 1)])
    await scores_col.create_index([("repo", 1), ("pr_number", 1)], unique=True)
    await parts_col.create_index([("github_username", 1)], unique=True)
    await parts_col.create_index([("total_score", -1)])
    await teams_col.create_index([("team_name", 1)], unique=True)
    await issues_col.create_index([("repo", 1), ("issue_number", 1)], unique=True)
    await pending_col.create_index([("repo", 1), ("pr_number", 1)], unique=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ensure_indexes()
    yield


app = FastAPI(title="Commit & Conquer", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Models ────────────────────────────────────────────────────────────────────

class ActionPayload(BaseModel):
    comment: str = ""


class ScorePayload(BaseModel):
    owner:            str = ""          # GitHub repo owner (optional, falls back to GITHUB_ORG)
    pr_number:        str
    repo:             str
    github_username:  str
    final_score:      int
    quality_score:    int = 0
    frontend_score:   int = 0
    backend_score:    int = 0
    bundle_score:     int = 0
    coverage_score:   int = 0
    tests_passed:     bool = False
    issue_count:      int = 0
    error_count:      int = 0
    warning_count:    int = 0
    lh_metrics:       dict = Field(default_factory=dict)
    be_metrics:       dict = Field(default_factory=dict)
    be_breakdown:     dict = Field(default_factory=dict)
    lint_issues:      list = Field(default_factory=list)
    status:           str = "ACCEPTED"
    issue_number:     Optional[int] = None
    issue_points:     int = 0
    issue_difficulty: str = "none"
    issue_title:      str = ""
    ai_review:        dict = Field(default_factory=dict)


class TeamCreate(BaseModel):
    team_name: str
    members:   List[str] = []


class TeamUpdate(BaseModel):
    team_name: Optional[str] = None
    members:   Optional[List[str]] = None


class ScoringConfigUpdate(BaseModel):
    pr_opened:       Optional[int] = None
    pipeline_passed: Optional[int] = None
    merged_bonus:    Optional[int] = None
    event_end_time:  Optional[str] = None   # ISO string


class IssueCreate(BaseModel):
    issue_number: int
    repo:         str
    title:        str
    points:       int = 0
    difficulty:   str = "medium"
    tags:         List[str] = []


class ManualAssign(BaseModel):
    """Direct point assignment — bypasses pipeline entirely."""
    points:  int
    note:    str = ""
    replace: bool = True   # True=replace total, False=add on top


class ManualScoreUpdate(BaseModel):
    manual_score: int
    note:         str = ""


class TeamScoreUpdate(BaseModel):
    score:   int
    note:    str  = ""
    replace: bool = True   # True = set directly, False = add on top


# ── WebSocket ─────────────────────────────────────────────────────────────────

class WsManager:
    def __init__(self):
        self.active: List[WebSocket] = []
        self.usernames: dict = {}   # ws → username

    async def connect(self, ws: WebSocket, username: str = ""):
        await ws.accept()
        self.active.append(ws)
        if username:
            self.usernames[id(ws)] = username

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)
        self.usernames.pop(id(ws), None)

    async def broadcast(self, msg: dict):
        dead = []
        for ws in self.active:
            try:
                await ws.send_json(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    @property
    def count(self):
        return len(self.active)


manager = WsManager()

# ── Helpers ───────────────────────────────────────────────────────────────────

def now_iso():
    return datetime.now(timezone.utc).isoformat()


def verify_sig(body: bytes, sig: str) -> bool:
    return True   # disabled for development


def normalize_repo(repo: str) -> str:
    """Converts 'Org/repo-name' -> 'repo-name'. Always store short name."""
    return repo.split("/")[-1] if "/" in repo else repo


def resolve_owner(pr_doc: Optional[dict], fallback: str = "") -> str:
    """
    Return the GitHub owner for a PR.
    Priority: pr_doc['owner'] → pr_doc['github_username'] → fallback → GITHUB_ORG
    """
    return (
        
        (pr_doc or {}).get("github_username")
        or fallback
        or GITHUB_ORG
    )


def str_id(doc: dict) -> dict:
    if doc and "_id" in doc:
        doc["_id"] = str(doc["_id"])
    return doc


_ISSUE_RE = re.compile(
    r"(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*#(\d+)", re.IGNORECASE
)


def parse_issue_number(title: str, body: str = "") -> Optional[int]:
    for text in (title or "", body or ""):
        m = _ISSUE_RE.search(text)
        if m:
            return int(m.group(1))
    return None


async def get_scoring_config() -> dict:
    doc = await config_col.find_one({"_id": "scoring"})
    return {
        "pr_opened":       doc.get("pr_opened", 5)        if doc else 5,
        "pipeline_passed": doc.get("pipeline_passed", 20) if doc else 20,
        "merged_bonus":    doc.get("merged_bonus", 15)    if doc else 15,
        "event_end_time":  doc.get("event_end_time", "")  if doc else "",
    }


async def resolve_team(github_username: str) -> Optional[dict]:
    """Find which team a username belongs to."""
    return await teams_col.find_one({"members": github_username})


async def is_banned(github_username: str) -> bool:
    return await banned_col.find_one({"username": github_username}) is not None


async def log_activity(action: str, detail: str, username: str = ""):
    await activity_col.insert_one(
        {"action": action, "detail": detail, "username": username, "created_at": now_iso()}
    )


async def recalculate_participant(github_username: str) -> int:
    sc_cur  = scores_col.find({"github_username": github_username}, {"_id": 0})
    all_sc  = await sc_cur.to_list(2000)
    pr_cur  = prs_col.find({"github_username": github_username}, {"_id": 0})
    all_prs = await pr_cur.to_list(2000)

    pipeline_score = sum(s.get("final_score", 0) for s in all_sc if s.get("status") == "ACCEPTED")
    bonus_score    = sum(p.get("bonus_score", 0) for p in all_prs)
    total_score    = pipeline_score + bonus_score
    merged_prs     = sum(1 for p in all_prs if p.get("status") == "merged")
    open_prs       = sum(1 for p in all_prs if p.get("status") == "open")
    passed_builds  = sum(1 for s in all_sc if s.get("tests_passed"))
    last_act       = max((p.get("updated_at", "") for p in all_prs), default=None)
    issues_solved  = sum(
        1 for p in all_prs if p.get("status") == "merged" and p.get("issue_number")
    )

    # Fetch avatar from GitHub if missing
    existing = await parts_col.find_one({"github_username": github_username})
    avatar = (existing or {}).get("avatar_url", "")
    if not avatar:
        try:
            async with httpx.AsyncClient() as c:
                r = await c.get(
                    f"https://api.github.com/users/{github_username}",
                    headers=get_gh_headers(),
                    timeout=5,
                )
                if r.status_code == 200:
                    avatar = r.json().get("avatar_url", "")
        except Exception:
            pass

    await parts_col.update_one(
        {"github_username": github_username},
        {
            "$set": {
                "github_username": github_username,
                "avatar_url":      avatar,
                "total_score":     total_score,
                "pipeline_score":  pipeline_score,
                "bonus_score":     bonus_score,
                "total_prs":       len(all_prs),
                "merged_prs":      merged_prs,
                "open_prs":        open_prs,
                "issues_solved":   issues_solved,
                "passed_builds":   passed_builds,
                "failed_builds":   len(all_sc) - passed_builds,
                "last_activity":   last_act,
            }
        },
        upsert=True,
    )
    return total_score


async def recalculate_team(team_id: str):
    """Rebuild team aggregate score from members."""
    team = await teams_col.find_one({"_id": ObjectId(team_id)})
    if not team:
        return
    members = team.get("members", [])

    total_score = 0
    merged_prs  = 0
    total_prs   = 0

    for username in members:
        p = await parts_col.find_one({"github_username": username})
        if p:
            total_score += p.get("total_score", 0)
            merged_prs  += p.get("merged_prs", 0)
            total_prs   += p.get("total_prs", 0)

    await teams_col.update_one(
        {"_id": ObjectId(team_id)},
        {
            "$set": {
                "total_score": total_score,
                "merged_prs":  merged_prs,
                "total_prs":   total_prs,
                "updated_at":  now_iso(),
            }
        },
    )


def check_admin(token: str):
    if token != ADMIN_TOKEN:
        raise HTTPException(403, "Unauthorized")


# ── Webhook ───────────────────────────────────────────────────────────────────

@app.post("/api/webhook/github")
async def github_webhook(request: Request):
    body       = await request.body()
    sig        = request.headers.get("X-Hub-Signature-256", "")
    event_type = request.headers.get("X-GitHub-Event", "")

    if not verify_sig(body, sig):
        raise HTTPException(401, "Invalid signature")

    payload = await request.json()
    action  = payload.get("action", "")

    if event_type == "pull_request" and action in ("opened", "reopened"):
        pr        = payload["pull_request"]
        repo_name = payload["repository"]["name"]
        # Store the repo owner from the webhook payload
        repo_owner = payload["repository"]["owner"]["login"]
        pr_number  = str(pr["number"])
        username   = pr["user"]["login"]

        if await is_banned(username):
            return {"status": "banned"}

        cfg       = await get_scoring_config()
        issue_num = parse_issue_number(pr.get("title", ""), pr.get("body") or "")

        team      = await resolve_team(username)
        team_id   = str(team["_id"]) if team else None
        team_name = team.get("team_name", "") if team else ""

        issue_title = None
        if issue_num:
            issue_doc = await issues_col.find_one({"repo": repo_name, "issue_number": issue_num})
            if issue_doc:
                issue_title = issue_doc.get("title")
            else:
                try:
                    async with httpx.AsyncClient() as c:
                        r = await c.get(
                            f"https://api.github.com/repos/{repo_owner}/{repo_name}/issues/{issue_num}",
                            headers=get_gh_headers(),
                            timeout=8,
                        )
                        if r.status_code == 200:
                            issue_title = r.json().get("title", "")
                except Exception:
                    pass

        is_duplicate = False
        if team_id and issue_num:
            existing_pr = await prs_col.find_one(
                {
                    "team_id":      team_id,
                    "issue_number": issue_num,
                    "status":       {"$in": ["open", "merged"]},
                }
            )
            if existing_pr and existing_pr.get("pr_number") != pr_number:
                is_duplicate = True

        pr_data = {
            "owner":            repo_owner,          # ← stored for later GitHub API calls
            "pr_number":        pr_number,
            "repo":             repo_name,
            "github_username":  username,
            "team_id":          team_id,
            "team_name":        team_name,
            "title":            pr.get("title", ""),
            "pr_link":          pr.get("html_url", ""),
            "branch_name":      pr.get("head", {}).get("ref", ""),
            "issue_number":     issue_num,
            "issue_title":      issue_title,
            "status":           "open",
            "ci_status":        "pending",
            "commits_count":    pr.get("commits", 0),
            "changed_files":    pr.get("changed_files", 0),
            "additions":        pr.get("additions", 0),
            "deletions":        pr.get("deletions", 0),
            "score":            0,
            "bonus_score":      0,
            "manual_score":     None,
            "is_duplicate_issue":        is_duplicate,
            "open_bonus_applied":        False,
            "pipeline_bonus_applied":    False,
            "merge_bonus_applied":       False,
            "issue_bonus_applied":       False,
            "score_approved":            False,
            "created_at": pr.get("created_at", now_iso()),
            "updated_at": now_iso(),
        }

        existing = await prs_col.find_one({"repo": repo_name, "pr_number": pr_number})
        if not existing:
            await prs_col.insert_one({**pr_data})
            await prs_col.update_one(
                {"repo": repo_name, "pr_number": pr_number},
                {"$set": {"open_bonus_applied": True, "bonus_score": cfg["pr_opened"]}},
            )
            pr_data["bonus_score"] = cfg["pr_opened"]
            await recalculate_participant(username)

        pr_data.pop("_id", None)
        await log_activity("pr_opened", f"@{username} opened PR #{pr_number}", username)
        await manager.broadcast({"type": "new_pr", "pr": pr_data})

    elif event_type == "pull_request" and action == "closed":
        pr        = payload["pull_request"]
        repo_name = payload["repository"]["name"]
        pr_number = str(pr["number"])
        username  = pr["user"]["login"]
        merged    = bool(pr.get("merged"))
        status    = "merged" if merged else "closed"

        await prs_col.update_one(
            {"repo": repo_name, "pr_number": pr_number},
            {"$set": {"status": status, "updated_at": now_iso()}},
        )

        if merged:
            pr_doc = await prs_col.find_one({"repo": repo_name, "pr_number": pr_number})
            cfg    = await get_scoring_config()

            if not (pr_doc or {}).get("merge_bonus_applied"):
                await prs_col.update_one(
                    {"repo": repo_name, "pr_number": pr_number},
                    {
                        "$set": {"merge_bonus_applied": True},
                        "$inc": {"bonus_score": cfg["merged_bonus"]},
                    },
                )

            if pr_doc and pr_doc.get("issue_number") and not pr_doc.get("is_duplicate_issue"):
                issue_doc = await issues_col.find_one(
                    {"repo": repo_name, "issue_number": pr_doc["issue_number"]}
                )
                if (
                    issue_doc
                    and issue_doc.get("points", 0) > 0
                    and not pr_doc.get("issue_bonus_applied")
                ):
                    pts = issue_doc["points"]
                    await prs_col.update_one(
                        {"repo": repo_name, "pr_number": pr_number},
                        {
                            "$set": {"issue_bonus_applied": True},
                            "$inc": {"bonus_score": pts},
                        },
                    )
                    await issues_col.update_one(
                        {"repo": repo_name, "issue_number": pr_doc["issue_number"]},
                        {"$set": {"status": "closed", "closed_at": now_iso()}},
                    )

            await recalculate_participant(username)
            if pr_doc and pr_doc.get("team_id"):
                await recalculate_team(pr_doc["team_id"])

        await log_activity("pr_" + status, f"PR #{pr_number} {status}", username)
        await manager.broadcast({"type": "status_update", "prId": pr_number, "status": status})

    elif event_type == "issues":
        issue     = payload.get("issue", {})
        repo_name = payload["repository"]["name"]
        action_   = payload.get("action", "")
        if action_ in ("opened", "edited", "labeled", "unlabeled"):
            labels = [l["name"] for l in issue.get("labels", [])]
            points = 0
            diff   = "medium"
            for l in labels:
                m = re.search(
                    r"(?:points?[-:]?\s*)(\d+)|(\d+)\s*(?:pts?|points?)", l, re.I
                )
                if m:
                    points = int(m.group(1) or m.group(2))
                    break
                if re.search(r"easy",   l, re.I): diff = "easy";   points = points or 10
                if re.search(r"medium", l, re.I): diff = "medium"; points = points or 20
                if re.search(r"hard",   l, re.I): diff = "hard";   points = points or 30

            await issues_col.update_one(
                {"repo": repo_name, "issue_number": issue["number"]},
                {
                    "$set": {
                        "issue_number": issue["number"],
                        "repo":         repo_name,
                        "title":        issue.get("title", ""),
                        "body":         issue.get("body", "") or "",
                        "points":       points,
                        "difficulty":   diff,
                        "tags":         labels,
                        "status":       "closed" if issue["state"] == "closed" else "open",
                        "assigned_to":  (issue.get("assignee") or {}).get("login"),
                        "created_at":   issue.get("created_at", now_iso()),
                        "issue_link":   issue.get("html_url", ""),
                    }
                },
                upsert=True,
            )

    elif event_type == "workflow_run" and action == "completed":
        run       = payload["workflow_run"]
        ci_status = "passed" if run.get("conclusion") == "success" else "failed"
        repo_name = payload["repository"]["name"]
        prs_in    = [str(p["number"]) for p in run.get("pull_requests", [])]
        for pr_num in prs_in:
            await prs_col.update_one(
                {"repo": repo_name, "pr_number": pr_num},
                {"$set": {"ci_status": ci_status, "updated_at": now_iso()}},
            )
            await manager.broadcast({"type": "ci_update", "prId": pr_num, "ci_status": ci_status})

    return {"status": "ok"}


# ── Score ingestion → pending approval ───────────────────────────────────────

@app.post("/api/scores")
async def ingest_score(payload: ScorePayload):
    """CI pipeline posts here. Score goes to PENDING state — admin must approve."""
    payload.repo = normalize_repo(payload.repo)
    now = now_iso()
    doc = payload.model_dump()
    doc["ingested_at"]    = now
    doc["approval_status"] = "pending"

    # Resolve owner: use payload.owner if provided, else fall back from PR doc
    pr_doc = await prs_col.find_one({"repo": payload.repo, "pr_number": payload.pr_number})
    doc["owner"] = payload.owner or resolve_owner(pr_doc, GITHUB_ORG)
    doc["is_duplicate_issue"] = (pr_doc or {}).get("is_duplicate_issue", False)

    print(
        f"[score ingest] owner={doc['owner']!r} repo={payload.repo!r} "
        f"pr={payload.pr_number!r} score={payload.final_score}"
    )

    await pending_col.update_one(
        {"repo": payload.repo, "pr_number": payload.pr_number},
        {"$set": doc},
        upsert=True,
    )

    await prs_col.update_one(
        {"repo": payload.repo, "pr_number": payload.pr_number},
        {
            "$set": {
                "ci_status":     "passed" if payload.tests_passed else "failed",
                "pending_score": payload.final_score,
                "score_approved": False,
                "updated_at":    now,
            }
        },
        upsert=True,
    )

    await manager.broadcast(
        {
            "type":      "score_pending",
            "pr_number": payload.pr_number,
            "username":  payload.github_username,
            "score":     payload.final_score,
            "ci_passed": payload.tests_passed,
            "ai_review": payload.ai_review,
        }
    )

    return {"status": "pending_approval", "message": "Score received, awaiting admin approval"}


@app.get("/api/scores/pending")
async def get_pending_scores(x_admin_token: str = Header("", alias="x-admin-token")):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(403, "Unauthorized")
    cursor = pending_col.find({"approval_status": "pending"}, {"_id": 0}).sort("ingested_at", -1)
    return await cursor.to_list(500)


@app.post("/api/scores/{repo}/{pr_number}/approve")
async def approve_score(
    repo: str,
    pr_number: str,
    x_admin_token: str = Header("", alias="x-admin-token"),
):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(403, "Unauthorized")

    pending = await pending_col.find_one({"repo": repo, "pr_number": pr_number})
    if not pending:
        raise HTTPException(404, "No pending score")

    now = now_iso()
    cfg = await get_scoring_config()

    pending.pop("_id", None)
    pending["approval_status"] = "approved"
    pending["approved_at"]     = now

    await scores_col.update_one(
        {"repo": repo, "pr_number": pr_number},
        {"$set": pending},
        upsert=True,
    )
    await pending_col.update_one(
        {"repo": repo, "pr_number": pr_number},
        {"$set": {"approval_status": "approved"}},
    )

    username = pending.get("github_username", "")

    pr_doc = await prs_col.find_one({"repo": repo, "pr_number": pr_number})
    if pending.get("tests_passed") and not (pr_doc or {}).get("pipeline_bonus_applied"):
        await prs_col.update_one(
            {"repo": repo, "pr_number": pr_number},
            {
                "$set": {"pipeline_bonus_applied": True},
                "$inc": {"bonus_score": cfg["pipeline_passed"]},
            },
        )

    issue_pts = pending.get("issue_points", 0)
    if (
        issue_pts > 0
        and not (pr_doc or {}).get("issue_bonus_applied")
        and not pending.get("is_duplicate_issue")
    ):
        await prs_col.update_one(
            {"repo": repo, "pr_number": pr_number},
            {
                "$set": {"issue_bonus_applied": True},
                "$inc": {"bonus_score": issue_pts},
            },
        )

    await prs_col.update_one(
        {"repo": repo, "pr_number": pr_number},
        {
            "$set": {
                "score":         pending.get("final_score", 0),
                "score_approved": True,
                "updated_at":    now,
            }
        },
    )

    total = await recalculate_participant(username)

    await manager.broadcast(
        {
            "type":            "score_update",
            "github_username": username,
            "total_score":     total,
            "pr_number":       pr_number,
            "final_score":     pending.get("final_score", 0),
        }
    )

    await log_activity("score_approved", f"Score approved for PR #{pr_number}", username)
    return {"status": "approved", "total_score": total}


@app.delete("/api/scores/{repo}/{pr_number}/pending")
async def reject_pending_score(
    repo: str,
    pr_number: str,
    x_admin_token: str = Header("", alias="x-admin-token"),
):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(403, "Unauthorized")
    await pending_col.update_one(
        {"repo": repo, "pr_number": pr_number},
        {"$set": {"approval_status": "rejected"}},
    )
    await prs_col.update_one(
        {"repo": repo, "pr_number": pr_number},
        {"$set": {"pending_score": None, "ci_status": "failed"}},
    )
    return {"status": "rejected"}


@app.get("/api/scores/{repo}/{pr_number}")
async def get_score(repo: str, pr_number: str):
    doc = await scores_col.find_one({"repo": repo, "pr_number": pr_number}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Score not found")
    return doc


# ── Manual score override ─────────────────────────────────────────────────────

@app.patch("/api/prs/{repo}/{pr_number}/manual_score")
async def set_manual_score(
    repo: str,
    pr_number: str,
    body: ManualScoreUpdate,
    x_admin_token: str = Header("", alias="x-admin-token"),
):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(403, "Unauthorized")

    await prs_col.update_one(
        {"repo": repo, "pr_number": pr_number},
        {
            "$set": {
                "manual_score":   body.manual_score,
                "score":          body.manual_score,
                "score_approved": True,
                "manual_note":    body.note,
                "updated_at":     now_iso(),
            }
        },
    )

    pr_doc = await prs_col.find_one({"repo": repo, "pr_number": pr_number})
    if pr_doc:
        username = pr_doc.get("github_username", "")
        total    = await recalculate_participant(username)
        await manager.broadcast(
            {
                "type":            "score_update",
                "github_username": username,
                "total_score":     total,
                "pr_number":       pr_number,
                "final_score":     body.manual_score,
            }
        )
        return {"status": "ok", "total_score": total}
    return {"status": "ok"}


# ── PRs ───────────────────────────────────────────────────────────────────────

@app.get("/api/prs")
async def get_prs(
    status:    Optional[str] = None,
    ci_status: Optional[str] = None,
    username:  Optional[str] = None,
    team_id:   Optional[str] = None,
    repo:      Optional[str] = None,
    page:  int = Query(1, ge=1),
    limit: int = Query(100, le=500),
):
    q: dict = {}
    if status:    q["status"]          = status
    if ci_status: q["ci_status"]       = ci_status
    if username:  q["github_username"] = username
    if team_id:   q["team_id"]         = team_id
    if repo:      q["repo"]            = repo

    skip   = (page - 1) * limit
    cursor = prs_col.find(q, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit)
    items  = await cursor.to_list(limit)
    total  = await prs_col.count_documents(q)
    return {"page": page, "limit": limit, "total": total, "prs": items}


@app.get("/api/pr/{repo}/{pr_number}")
async def get_pr_diff_endpoint(repo: str, pr_number: str):
    repo   = normalize_repo(repo)
    pr_doc = await prs_col.find_one({"repo": repo, "pr_number": pr_number}, {"_id": 0})
    owner  = resolve_owner(pr_doc, GITHUB_ORG)

    print(f"[diff] owner={owner!r} repo={repo!r} pr={pr_number!r}")

    try:
        diff_text = await get_pull_diff(owner, repo, pr_number)
        return {
            "success":      True,
            "repo":         repo,
            "pr_number":    pr_number,
            "diff":         diff_text,
            "pull_request": pr_doc or {},
        }
    except httpx.HTTPStatusError as e:
        print(f"[diff] GitHub {e.response.status_code} for {owner}/{repo}#{pr_number}")
        raise HTTPException(
            e.response.status_code,
            f"GitHub returned {e.response.status_code}",
        )
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/pr/{repo}/{pr_number}/files")
async def get_pr_files_endpoint(repo: str, pr_number: str):
    repo   = normalize_repo(repo)
    pr_doc = await prs_col.find_one({"repo": repo, "pr_number": pr_number}, {"_id": 0})
    owner  = resolve_owner(pr_doc, GITHUB_ORG)

    print(
        f"[files] owner={owner!r} repo={repo!r} pr={pr_number!r} "
        f"→ GET repos/{owner}/{repo}/pulls/{pr_number}/files"
    )

    try:
        files = await get_pull_files(owner, repo, pr_number)
        return {
            "success":      True,
            "repo":         repo,
            "pr_number":    pr_number,
            "files":        files,
            "pull_request": pr_doc or {},
        }
    except httpx.HTTPStatusError as e:
        print(
            f"[files] GitHub {e.response.status_code} — "
            f"URL: repos/{owner}/{repo}/pulls/{pr_number}/files"
        )
        raise HTTPException(
            e.response.status_code,
            f"GitHub returned {e.response.status_code}",
        )
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/pr/{repo}/{pr_number}/approve")
async def approve_pr(repo: str, pr_number: str, body: ActionPayload):
    repo   = normalize_repo(repo)
    pr_doc = await prs_col.find_one({"repo": repo, "pr_number": pr_number})
    if not pr_doc:
        raise HTTPException(404, "PR not found")

    owner = resolve_owner(pr_doc, GITHUB_ORG)
    print(f"[merge] owner={owner!r} repo={repo!r} pr={pr_number!r}")

    try:
        await merge_pull_request(owner, repo, pr_number, body.comment or "")
    except httpx.HTTPStatusError as e:
        err = {}
        try:
            err = e.response.json()
        except Exception:
            pass
        print(f"[merge] GitHub {e.response.status_code}: {err}")
        raise HTTPException(
            e.response.status_code,
            f"GitHub merge failed: {err.get('message', e.response.text)}",
        )
    except Exception as e:
        raise HTTPException(500, str(e))

    username = pr_doc.get("github_username", "")
    cfg      = await get_scoring_config()

    if not pr_doc.get("merge_bonus_applied"):
        await prs_col.update_one(
            {"repo": repo, "pr_number": pr_number},
            {
                "$set": {"status": "merged", "merge_bonus_applied": True, "updated_at": now_iso()},
                "$inc": {"bonus_score": cfg["merged_bonus"]},
            },
        )
    else:
        await prs_col.update_one(
            {"repo": repo, "pr_number": pr_number},
            {"$set": {"status": "merged", "updated_at": now_iso()}},
        )

    await recalculate_participant(username)
    await manager.broadcast({"type": "status_update", "prId": pr_number, "status": "merged"})
    await log_activity("pr_approved", f"PR #{pr_number} approved and merged", username)
    return {"success": True, "message": f"PR {pr_number} merged successfully"}


@app.post("/api/pr/{repo}/{pr_number}/reject")
async def reject_pr(repo: str, pr_number: str, body: ActionPayload):
    repo   = normalize_repo(repo)
    pr_doc = await prs_col.find_one({"repo": repo, "pr_number": pr_number})
    owner  = resolve_owner(pr_doc, GITHUB_ORG)
    github_error = None

    print(f"[reject] owner={owner!r} repo={repo!r} pr={pr_number!r}")

    try:
        await close_pull_request(owner, repo, pr_number)
        if body.comment:
            await post_issue_comment(
                owner, repo, pr_number,
                f"❌ **Rejected by judges**\n\n{body.comment}",
            )
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 422:
            github_error = "PR was already closed on GitHub"
        elif e.response.status_code in (401, 403):
            raise HTTPException(403, "GitHub token invalid or expired. Check GITHUB_TOKEN in .env")
        elif e.response.status_code == 404:
            github_error = f"PR not found on GitHub ({owner}/{repo}#{pr_number})"
        else:
            err = {}
            try:
                err = e.response.json()
            except Exception:
                pass
            print(f"[reject] GitHub {e.response.status_code}: {err}")
            raise HTTPException(
                e.response.status_code,
                f"GitHub close failed: {err.get('message', e.response.text)}",
            )
    except Exception as e:
        raise HTTPException(500, str(e))

    await prs_col.update_one(
        {"repo": repo, "pr_number": pr_number},
        {"$set": {"status": "rejected", "updated_at": now_iso()}},
    )
    await manager.broadcast({"type": "status_update", "prId": pr_number, "status": "rejected"})
    return {"success": True, "message": f"PR {pr_number} rejected", "github_note": github_error}


# ── Issues ────────────────────────────────────────────────────────────────────

@app.get("/api/debug/token")
async def debug_token():
    token = os.getenv("GITHUB_TOKEN", "")
    return {"token_prefix": token[:10] if token else "EMPTY", "length": len(token)}


@app.get("/api/issues")
async def list_issues(
    status: Optional[str] = None,
    repo:   Optional[str] = None,
    limit:  int = Query(100, le=500),
):
    q: dict = {}
    if status: q["status"] = status
    if repo:   q["repo"]   = repo
    cursor = issues_col.find(q, {"_id": 0}).sort("issue_number", 1).limit(limit)
    items  = await cursor.to_list(limit)
    return {"total": len(items), "issues": items}


@app.post("/api/issues")
async def create_issue(
    body: IssueCreate,
    x_admin_token: str = Header("", alias="x-admin-token"),
):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(403, "Unauthorized")
    doc = body.model_dump()
    doc["status"]     = "open"
    doc["created_at"] = now_iso()
    await issues_col.update_one(
        {"repo": body.repo, "issue_number": body.issue_number},
        {"$setOnInsert": doc},
        upsert=True,
    )
    return {"status": "ok"}


@app.delete("/api/issues/{repo}/{issue_number}")
async def delete_issue(
    repo: str,
    issue_number: int,
    x_admin_token: str = Header("", alias="x-admin-token"),
):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(403, "Unauthorized")
    result = await issues_col.delete_one({"repo": repo, "issue_number": issue_number})
    if result.deleted_count == 0:
        raise HTTPException(404, "Issue not found")
    return {"status": "deleted"}


@app.patch("/api/issues/{repo}/{issue_number}")
async def update_issue(
    repo: str,
    issue_number: int,
    body: dict,
    x_admin_token: str = Header("", alias="x-admin-token"),
):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(403, "Unauthorized")
    allowed = {"points", "difficulty", "tags", "status", "title"}
    safe = {k: v for k, v in body.items() if k in allowed}
    if not safe:
        raise HTTPException(400, "Nothing to update")
    await issues_col.update_one({"repo": repo, "issue_number": issue_number}, {"$set": safe})
    return {"status": "ok"}


# ── Teams ─────────────────────────────────────────────────────────────────────

@app.get("/api/teams")
async def list_teams():
    cursor = teams_col.find({}).sort("total_score", -1)
    teams  = await cursor.to_list(500)
    for t in teams:
        t["_id"] = str(t["_id"])
    return teams


@app.post("/api/teams")
async def create_team(
    body: TeamCreate,
    x_admin_token: str = Header("", alias="x-admin-token"),
):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(403, "Unauthorized")
    existing = await teams_col.find_one({"team_name": body.team_name})
    if existing:
        raise HTTPException(400, "Team name already exists")
    result = await teams_col.insert_one(
        {
            "team_name":   body.team_name,
            "members":     [m.strip() for m in body.members],
            "total_score": 0,
            "merged_prs":  0,
            "total_prs":   0,
            "created_at":  now_iso(),
        }
    )
    return {"status": "ok", "team_id": str(result.inserted_id)}


@app.patch("/api/teams/{team_id}")
async def update_team(
    team_id: str,
    body: TeamUpdate,
    x_admin_token: str = Header("", alias="x-admin-token"),
):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(403, "Unauthorized")
    update = {}
    if body.team_name is not None: update["team_name"] = body.team_name
    if body.members   is not None: update["members"]   = [m.strip() for m in body.members]
    if not update:
        raise HTTPException(400, "Nothing to update")
    await teams_col.update_one({"_id": ObjectId(team_id)}, {"$set": update})
    return {"status": "ok"}


@app.patch("/api/teams/{team_id}/score")
async def set_team_score(
    team_id: str,
    body: TeamScoreUpdate,
    x_admin_token: str = Header("", alias="x-admin-token"),
):
    """Admin manually sets or adds a score to a team."""
    check_admin(x_admin_token)
    team = await teams_col.find_one({"_id": ObjectId(team_id)})
    if not team:
        raise HTTPException(404, "Team not found")

    current   = team.get("total_score", 0)
    new_score = body.score if body.replace else current + body.score

    await teams_col.update_one(
        {"_id": ObjectId(team_id)},
        {
            "$set": {
                "total_score":    new_score,
                "manual_score":   new_score,
                "manual_note":    body.note,
                "updated_at":     now_iso(),
            }
        },
    )

    await log_activity(
        "manual_team_score",
        f"Admin set score {new_score} for team '{team.get('team_name', team_id)}'. Note: {body.note}",
        "admin",
    )
    await manager.broadcast(
        {"type": "team_score_update", "team_id": team_id, "total_score": new_score}
    )

    return {"status": "ok", "team_id": team_id, "total_score": new_score}


@app.delete("/api/teams/{team_id}")
async def delete_team(
    team_id: str,
    x_admin_token: str = Header("", alias="x-admin-token"),
):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(403, "Unauthorized")
    await teams_col.delete_one({"_id": ObjectId(team_id)})
    return {"status": "deleted"}


@app.post("/api/teams/{team_id}/members")
async def add_member(
    team_id: str,
    body: dict,
    x_admin_token: str = Header("", alias="x-admin-token"),
):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(403, "Unauthorized")
    username = body.get("username", "").strip()
    if not username:
        raise HTTPException(400, "username required")
    await teams_col.update_one(
        {"_id": ObjectId(team_id)}, {"$addToSet": {"members": username}}
    )
    return {"status": "ok"}


@app.delete("/api/teams/{team_id}/members/{username}")
async def remove_member(
    team_id: str,
    username: str,
    x_admin_token: str = Header("", alias="x-admin-token"),
):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(403, "Unauthorized")
    await teams_col.update_one(
        {"_id": ObjectId(team_id)}, {"$pull": {"members": username}}
    )
    return {"status": "ok"}


# ── Manual point assignment ───────────────────────────────────────────────────

@app.post("/api/assign/{github_username}")
async def assign_score(
    github_username: str,
    body: ManualAssign,
    x_admin_token: str = Header("", alias="x-admin-token"),
):
    """
    Admin manually assigns points to any participant.
    replace=True  → sets total_score directly
    replace=False → adds on top of existing score
    """
    check_admin(x_admin_token)
    now = now_iso()

    p       = await parts_col.find_one({"github_username": github_username})
    current = (p or {}).get("total_score", 0)
    new_total = body.points if body.replace else current + body.points

    await parts_col.update_one(
        {"github_username": github_username},
        {
            "$set": {
                "github_username": github_username,
                "total_score":     new_total,
                "manual_override": True,
                "manual_note":     body.note,
                "last_activity":   now,
            }
        },
        upsert=True,
    )

    team = await teams_col.find_one({"members": github_username})
    if team:
        await recalculate_team(str(team["_id"]))

    await log_activity(
        "manual_assign",
        f"Admin assigned {body.points} pts to @{github_username}. Note: {body.note}",
        "admin",
    )
    await manager.broadcast(
        {
            "type":            "score_update",
            "github_username": github_username,
            "total_score":     new_total,
            "pr_number":       "",
            "final_score":     new_total,
        }
    )

    return {"status": "ok", "github_username": github_username, "total_score": new_total}


@app.get("/api/assign/all")
async def list_assignments(x_admin_token: str = Header("", alias="x-admin-token")):
    check_admin(x_admin_token)
    cursor = parts_col.find({"manual_override": True}, {"_id": 0}).sort("total_score", -1)
    return await cursor.to_list(500)


# ── Leaderboard ───────────────────────────────────────────────────────────────

@app.get("/api/leaderboard")
async def get_leaderboard(
    page:  int = Query(1, ge=1),
    limit: int = Query(100, le=200),
    mode:  str = "individual",
):
    skip = (page - 1) * limit
    if mode == "team":
        cursor = teams_col.find({}, {"_id": 0}).sort("total_score", -1).skip(skip).limit(limit)
        rows   = await cursor.to_list(limit)
        total  = await teams_col.count_documents({})
    else:
        cursor = parts_col.find({}, {"_id": 0}).sort("total_score", -1).skip(skip).limit(limit)
        rows   = await cursor.to_list(limit)
        total  = await parts_col.count_documents({})

    for i, r in enumerate(rows):
        r["rank"] = skip + i + 1

    return {"page": page, "limit": limit, "total": total, "participants": rows, "mode": mode}


@app.get("/api/leaderboard/participant/{username}")
async def get_participant(username: str):
    p = await parts_col.find_one({"github_username": username}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Not found")

    higher    = await parts_col.count_documents({"total_score": {"$gt": p.get("total_score", 0)}})
    p["rank"] = higher + 1

    pr_cur        = prs_col.find({"github_username": username}, {"_id": 0}).sort("created_at", -1)
    p["prs"]      = await pr_cur.to_list(200)

    sc_cur              = scores_col.find({"github_username": username}, {"_id": 0}).sort("ingested_at", -1)
    p["score_details"]  = await sc_cur.to_list(200)

    team = await resolve_team(username)
    if team:
        p["team_name"] = team.get("team_name", "")
        p["team_id"]   = str(team["_id"])

    return p


# ── Export ────────────────────────────────────────────────────────────────────

@app.get("/api/export/leaderboard")
async def export_leaderboard(x_admin_token: str = Header("", alias="x-admin-token")):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(403, "Unauthorized")

    cursor = parts_col.find({}, {"_id": 0}).sort("total_score", -1)
    rows   = await cursor.to_list(2000)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        ["Rank", "Username", "Total Score", "Pipeline Score", "Bonus",
         "Merged PRs", "Total PRs", "Issues Solved", "Last Active"]
    )
    for i, r in enumerate(rows):
        writer.writerow(
            [
                i + 1,
                r.get("github_username"),
                r.get("total_score"),
                r.get("pipeline_score"),
                r.get("bonus_score"),
                r.get("merged_prs"),
                r.get("total_prs"),
                r.get("issues_solved"),
                r.get("last_activity", ""),
            ]
        )
    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.read().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=leaderboard.csv"},
    )


# ── Admin ─────────────────────────────────────────────────────────────────────

@app.get("/api/admin/config")
async def admin_get_config(x_admin_token: str = Header("", alias="x-admin-token")):
    check_admin(x_admin_token)
    return await get_scoring_config()


@app.patch("/api/admin/config")
async def admin_update_config(
    body: ScoringConfigUpdate,
    x_admin_token: str = Header("", alias="x-admin-token"),
):
    check_admin(x_admin_token)
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    await config_col.update_one({"_id": "scoring"}, {"$set": update}, upsert=True)
    return await get_scoring_config()


@app.post("/api/admin/recalculate")
async def admin_recalculate(x_admin_token: str = Header("", alias="x-admin-token")):
    check_admin(x_admin_token)
    users   = await parts_col.find({}, {"github_username": 1}).to_list(2000)
    results = {}
    for u in users:
        un          = u["github_username"]
        results[un] = await recalculate_participant(un)
    return {"recalculated": len(results), "scores": results}


@app.get("/api/admin/activity")
async def get_activity(
    limit: int = 50,
    x_admin_token: str = Header("", alias="x-admin-token"),
):
    check_admin(x_admin_token)
    cursor = activity_col.find({}, {"_id": 0}).sort("created_at", -1).limit(limit)
    return await cursor.to_list(limit)


@app.post("/api/admin/ban/{username}")
async def ban_user(username: str, x_admin_token: str = Header("", alias="x-admin-token")):
    check_admin(x_admin_token)
    await banned_col.update_one(
        {"username": username},
        {"$set": {"username": username, "banned_at": now_iso()}},
        upsert=True,
    )
    return {"status": "banned"}


@app.delete("/api/admin/ban/{username}")
async def unban_user(username: str, x_admin_token: str = Header("", alias="x-admin-token")):
    check_admin(x_admin_token)
    await banned_col.delete_one({"username": username})
    return {"status": "unbanned"}


@app.get("/api/admin/banned")
async def list_banned(x_admin_token: str = Header("", alias="x-admin-token")):
    check_admin(x_admin_token)
    cursor = banned_col.find({}, {"_id": 0})
    return await cursor.to_list(500)


# ── DB Cleanup ────────────────────────────────────────────────────────────────

@app.post("/api/admin/cleanup")
async def cleanup_duplicates(x_admin_token: str = Header("", alias="x-admin-token")):
    """
    Remove ghost PR records created by old score POSTs that stored full repo path.
    Safe to run multiple times.
    """
    check_admin(x_admin_token)
    cursor  = prs_col.find({"repo": {"$regex": "/"}}, {"_id": 1, "repo": 1, "pr_number": 1})
    docs    = await cursor.to_list(2000)
    deleted = 0

    for doc in docs:
        clean = normalize_repo(doc["repo"])
        twin  = await prs_col.find_one({"repo": clean, "pr_number": doc["pr_number"]})
        if twin:
            await prs_col.delete_one({"_id": doc["_id"]})
            deleted += 1
        else:
            await prs_col.update_one({"_id": doc["_id"]}, {"$set": {"repo": clean}})

    for col in [scores_col, pending_col]:
        cur  = col.find({"repo": {"$regex": "/"}}, {"_id": 1, "repo": 1})
        rows = await cur.to_list(2000)
        for r in rows:
            await col.update_one({"_id": r["_id"]}, {"$set": {"repo": normalize_repo(r["repo"])}})

    return {"deleted_duplicates": deleted, "fixed_repos": len(docs) - deleted}


# ── Debug ─────────────────────────────────────────────────────────────────────

@app.get("/api/debug/token")
async def debug_token():
    token = os.getenv("GITHUB_TOKEN", "")
    return {"token_prefix": token[:10] if token else "EMPTY", "length": len(token)}


@app.get("/api/debug/github")
async def debug_github(repo: str = "commit-conquer", pr_number: str = "1"):
    """Test if GitHub token works and has correct permissions."""
    try:
        async with httpx.AsyncClient() as c:
            r = await c.get(
                "https://api.github.com/user",
                headers=get_gh_headers(),
                timeout=5,
            )
            user = r.json() if r.status_code == 200 else {"error": f"HTTP {r.status_code}"}

            r2 = await c.get(
                f"https://api.github.com/repos/{GITHUB_ORG}/{repo}",
                headers=get_gh_headers(),
                timeout=5,
            )

            return {
                "token_user":         user.get("login", user),
                "token_scopes":       r.headers.get("x-oauth-scopes", "unknown"),
                "repo_access_status": r2.status_code,
                "github_org":         GITHUB_ORG,
            }
    except Exception as e:
        return {"error": str(e)}


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/api/live")
async def ws_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        active_count = await parts_col.count_documents({})
        await ws.send_json(
            {"type": "teams_online", "count": manager.count, "total_participants": active_count}
        )
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)
        await manager.broadcast({"type": "teams_online", "count": manager.count})


@app.get("/api/health")
async def health():
    return {"status": "ok", "ws_connections": manager.count}