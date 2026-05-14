import os
import httpx
from dotenv import load_dotenv

load_dotenv()


def get_gh_headers():
    load_dotenv(override=True)

    token = os.getenv("GITHUB_TOKEN", "")

    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


async def get_pull_request(owner: str, repo: str, pr_number: str):

    url = f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}"

    print("GET PR:", url)

    async with httpx.AsyncClient() as client:

        response = await client.get(
            url,
            headers=get_gh_headers(),
            timeout=15
        )

        print(response.status_code, response.text)

        response.raise_for_status()

        return response.json()


async def get_pull_files(owner: str, repo: str, pr_number: str):
    url = f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/files"
    print("GET FILES:", url)
    async with httpx.AsyncClient(follow_redirects=True) as client:  # ← add this
        response = await client.get(
            url,
            headers=get_gh_headers(),
            timeout=15
        )
        print(response.status_code)
        response.raise_for_status()
        return response.json()

async def get_pull_diff(owner: str, repo: str, pr_number: str):
    url = f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}"
    headers = {
        **get_gh_headers(),
        "Accept": "application/vnd.github.v3.diff"
    }
    print("GET DIFF:", url)
    async with httpx.AsyncClient(follow_redirects=True) as client:  # ← add this
        response = await client.get(
            url,
            headers=headers,
            timeout=15
        )
        print(response.status_code)
        response.raise_for_status()
        return response.text

async def merge_pull_request(owner: str, repo: str, pr_number: str, commit_message: str = ""):
    url = f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/merge"
    payload = {"merge_method": "squash"}
    print("MERGE:", url)
    async with httpx.AsyncClient(follow_redirects=True) as client:  # ← add this
        response = await client.put(
            url,
            headers=get_gh_headers(),
            json=payload,
            timeout=20
        )
        print(response.status_code, response.text)
        response.raise_for_status()
        return response.json()


async def close_pull_request(owner: str, repo: str, pr_number: str):
    url = f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}"
    payload = {"state": "closed"}
    print("CLOSE:", url)
    async with httpx.AsyncClient(follow_redirects=True) as client:  # ← add this
        response = await client.patch(
            url,
            headers=get_gh_headers(),
            json=payload,
            timeout=20
        )
        print(response.status_code, response.text)
        response.raise_for_status()
        return response.json()
async def close_issue(owner: str, repo: str, issue_number: int):

    url = f"https://api.github.com/repos/{owner}/{repo}/issues/{issue_number}"

    payload = {
        "state": "closed"
    }

    async with httpx.AsyncClient() as client:

        response = await client.patch(
            url,
            headers=get_gh_headers(),
            json=payload
        )

        response.raise_for_status()

        return response.json()
async def post_issue_comment(
    owner: str,
    repo: str,
    issue_number: str,
    body: str
):

    url = f"https://api.github.com/repos/{owner}/{repo}/issues/{issue_number}/comments"

    payload = {
        "body": body
    }

    print("POST COMMENT:", url)

    async with httpx.AsyncClient() as client:

        response = await client.post(
            url,
            headers=get_gh_headers(),
            json=payload,
            timeout=15
        )

        print(response.status_code, response.text)

        response.raise_for_status()

        return response.json()        