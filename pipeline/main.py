"""
Automated call audit pipeline — runs on Railway (no GCP infra needed).

Every execution:
  1. Lists audio files in the Google Drive folder
  2. Skips files already in Supabase
  3. Downloads new files → transcribes via Gemini multimodal API
  4. Scores transcript using Gemini 2.5 Flash with structured JSON output
  5. Stores transcript + scores in Supabase
  6. Sends Slack message for calls > 3 minutes (with audio file if bot token set)
"""
import base64
import json
import os
import tempfile
from pathlib import Path

import requests
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
import supabase as sb
from mutagen import File as MutagenFile

# ── Config ────────────────────────────────────────────────────────────────────
DRIVE_FOLDER_ID  = "1qAA2I00k827z55_4P2LUNyijgG-1-PxZ"
GEMINI_API_KEY   = os.environ["GEMINI_API_KEY"]
GEMINI_MODEL     = "gemini-2.5-flash"
GEMINI_URL       = (
    f"https://generativelanguage.googleapis.com/v1beta"
    f"/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
)
SUPABASE_URL     = os.environ["SUPABASE_URL"]
SUPABASE_KEY     = os.environ["SUPABASE_KEY"]
SLACK_WEBHOOK    = os.environ.get("SLACK_WEBHOOK_URL", "")
SLACK_BOT_TOKEN  = os.environ.get("SLACK_BOT_TOKEN", "")
SLACK_CHANNEL_ID = os.environ.get("SLACK_CHANNEL_ID", "")
SLACK_MIN_SECS   = 180   # only notify for calls > 3 minutes
MAX_INLINE_BYTES = 20 * 1024 * 1024  # Gemini inline_data limit

MIME_MAP = {
    ".mp3": "audio/mpeg", ".mp4": "audio/mp4",  ".m4a": "audio/mp4",
    ".wav": "audio/wav",  ".ogg": "audio/ogg",   ".webm": "audio/webm",
    ".aac": "audio/aac",  ".flac": "audio/flac",  ".mpeg": "audio/mpeg",
}

TRANSCRIBE_PROMPT = (
    "You are transcribing a sales call recording from SuperSheldon, an educational tutoring "
    "company operating in Australia and the UK. The sales agent has an Indian accent and is "
    "calling parents to pitch tutoring services for their children.\n\n"
    'Important: "SuperSheldon" is the company name — the audio may pronounce it as '
    '"Super Children", "Super Stallion", or similar. Always transcribe it as "SuperSheldon".\n\n'
    "Transcribe the full conversation accurately. Preserve speaker turns naturally (start each "
    "turn on a new line). Return ONLY the transcript text — no headings, no commentary, no timestamps."
)

SYSTEM_PROMPT = (
    "You are a senior call-quality auditor for SuperSheldon, an educational tutoring company "
    "operating in Australia and the UK. SuperSheldon's sales agents (with Indian accents) call "
    "parents to pitch tutoring services for their children.\n\n"
    "Your task is to evaluate the call transcript against the rubric parameters provided and "
    "return a score for each parameter. Be strict, fair, and cite specific moments from the "
    "transcript in your reasoning. Score only what actually happened in the call — do not give "
    "credit for things not said."
)

# ── Clients ───────────────────────────────────────────────────────────────────
supabase_client = sb.create_client(SUPABASE_URL, SUPABASE_KEY)


def get_drive_service():
    """Build Drive service from GOOGLE_CREDENTIALS_JSON env var (service account JSON string)."""
    creds_json = os.environ.get("GOOGLE_CREDENTIALS_JSON", "")
    if creds_json:
        info  = json.loads(creds_json)
        creds = service_account.Credentials.from_service_account_info(
            info, scopes=["https://www.googleapis.com/auth/drive.readonly"]
        )
    else:
        # local dev fallback — Application Default Credentials
        from google.auth import default as gauth_default
        creds, _ = gauth_default(scopes=["https://www.googleapis.com/auth/drive.readonly"])
    return build("drive", "v3", credentials=creds)


# ── Stage 1: Drive ────────────────────────────────────────────────────────────
def get_processed_drive_ids() -> set[str]:
    res = supabase_client.table("calls").select("drive_link").execute()
    ids = set()
    for row in (res.data or []):
        link = row.get("drive_link", "")
        if "id=" in link:
            ids.add(link.split("id=")[-1].strip())
        elif "/file/d/" in link:
            ids.add(link.split("/file/d/")[1].split("/")[0])
    return ids


def list_drive_audio(drive_svc) -> list[dict]:
    files, page_token = [], None
    while True:
        resp = drive_svc.files().list(
            q=(
                f"'{DRIVE_FOLDER_ID}' in parents and "
                "(mimeType contains 'audio/' or mimeType contains 'video/')"
            ),
            fields="nextPageToken, files(id, name, mimeType)",
            pageToken=page_token,
        ).execute()
        files.extend(resp.get("files", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return files


# ── Stage 2: Transcription ────────────────────────────────────────────────────
def get_audio_duration(file_path: str) -> float | None:
    try:
        audio = MutagenFile(file_path)
        if audio and hasattr(audio.info, "length"):
            return float(audio.info.length)
    except Exception:
        pass
    return None


def gemini_post(body: dict, timeout: int = 300) -> str:
    resp = requests.post(GEMINI_URL, json=body, timeout=timeout)
    resp.raise_for_status()
    return resp.json()["candidates"][0]["content"]["parts"][0]["text"]


def upload_to_gemini_file_api(file_path: str, mime_type: str) -> str:
    """Upload file > 20 MB to Gemini File API; returns the file URI."""
    upload_url = (
        f"https://generativelanguage.googleapis.com/upload/v1beta/files"
        f"?key={GEMINI_API_KEY}"
    )
    with open(file_path, "rb") as fh:
        resp = requests.post(
            upload_url,
            headers={
                "X-Goog-Upload-Command": "upload, finalize",
                "Content-Type": mime_type,
            },
            data=fh,
            timeout=300,
        )
    resp.raise_for_status()
    return resp.json()["file"]["uri"]


def transcribe(file_path: str, suffix: str) -> str:
    mime_type = MIME_MAP.get(suffix.lower(), "audio/mpeg")
    file_size = os.path.getsize(file_path)

    if file_size <= MAX_INLINE_BYTES:
        with open(file_path, "rb") as fh:
            b64 = base64.b64encode(fh.read()).decode()
        audio_part = {"inline_data": {"mime_type": mime_type, "data": b64}}
    else:
        print(f"  File > 20 MB — using Gemini File API upload")
        file_uri   = upload_to_gemini_file_api(file_path, mime_type)
        audio_part = {"file_data": {"mime_type": mime_type, "file_uri": file_uri}}

    text = gemini_post({
        "contents": [{"parts": [{"text": TRANSCRIBE_PROMPT}, audio_part]}],
        "generationConfig": {"temperature": 0.0},
    })
    if not text.strip():
        raise ValueError("Gemini returned an empty transcript")
    return text.strip()


# ── Stage 3: Scoring ──────────────────────────────────────────────────────────
def build_prompt(
    rubric_params: list[dict],
    transcript: str,
    duration_seconds: float | None = None,
) -> str:
    def param_line(p: dict) -> str:
        criteria = f" — \"{p['description']}\"" if p.get("description") else ""
        if p.get("type") == "yes_no":
            return f"  - {p['name']}{criteria}: YES={p['max_score']} / NO=0  ← BINARY ONLY, no partial credit"
        if p.get("type") == "categorical":
            return f"  - {p['name']}{criteria}: integer 0–{p['max_score']}  ← pick the closest level"
        return f"  - {p['name']}{criteria}: integer 0–{p['max_score']}"

    param_lines   = "\n".join(param_line(p) for p in rubric_params)
    scoring_rules = (
        "## SCORING RULES\n"
        "1. YES/NO parameters (marked BINARY): score must be EITHER 0 OR the full max — never 1 on a max-2 parameter.\n"
        "2. Only award YES if the thing clearly happened. If absent, uncertain, or cut short → 0.\n"
        "3. Numeric parameters: use the full range 0–max, be proportional to quality.\n"
        "4. Agent name: identify the sales agent's first name from their self-introduction "
        '(e.g. "Hi, I\'m Priya from SuperSheldon"). Use null if unclear.\n'
        f"5. COMPLETENESS: you MUST return a score for every single one of the {len(rubric_params)} parameters listed. "
        "Never skip or omit a parameter. If something clearly did not happen, score it 0."
    )
    meta_section = ""
    if duration_seconds is not None:
        mins   = int(duration_seconds // 60)
        secs   = round(duration_seconds % 60)
        longer = "YES" if duration_seconds > 180 else "NO"
        meta_section = (
            f"\n\n## Call Metadata\n"
            f"- Duration: {mins}m {secs}s ({round(duration_seconds)}s total)\n"
            f"- Longer than 3 minutes: {longer}"
        )
    return (
        SYSTEM_PROMPT
        + f"\n\n{scoring_rules}"
        + meta_section
        + f"\n\n## Rubric Parameters (all {len(rubric_params)} must be scored)\n{param_lines}"
        + "\n\nFull rubric definition (JSON):\n"
        + json.dumps(rubric_params, indent=2)
        + f"\n\n## Call Transcript\n{transcript}"
        + f"\n\nRespond ONLY with a JSON object containing exactly {len(rubric_params)} score entries: "
        + '{"agent_name":"<first name or null>","scores":[{"parameter":"<name>","score":<integer>,"reasoning":"<1-2 sentences>"},...]}. '
        + "Extract the agent's first name from their self-introduction. Use null if unclear."
    )


def score_transcript(
    transcript: str,
    rubric_params: list[dict],
    duration_seconds: float | None = None,
) -> tuple[list[dict], str | None]:
    prompt = build_prompt(rubric_params, transcript, duration_seconds)
    text   = gemini_post({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.1},
    })
    parsed = json.loads(text)
    return parsed.get("scores", []), parsed.get("agent_name") or None


# ── Stage 4: Slack ────────────────────────────────────────────────────────────
_DEMO_LEVELS = ["Not attempted", "Mentioned, declined", "Callback booked", "Demo confirmed"]


def upload_audio_to_slack(file_path: str, filename: str) -> str | None:
    """Upload audio file to Slack channel; returns permalink or None."""
    if not SLACK_BOT_TOKEN or not SLACK_CHANNEL_ID:
        return None
    try:
        file_size = os.path.getsize(file_path)
        r1 = requests.post(
            "https://slack.com/api/files.getUploadURLExternal",
            headers={"Authorization": f"Bearer {SLACK_BOT_TOKEN}"},
            json={"filename": filename, "length": file_size},
            timeout=30,
        )
        d1 = r1.json()
        if not d1.get("ok"):
            print(f"  Slack upload URL error: {d1.get('error')}")
            return None

        with open(file_path, "rb") as fh:
            r2 = requests.post(d1["upload_url"], data=fh, timeout=180)
        if not r2.ok:
            print(f"  Slack file PUT failed: {r2.status_code}")
            return None

        r3 = requests.post(
            "https://slack.com/api/files.completeUploadExternal",
            headers={"Authorization": f"Bearer {SLACK_BOT_TOKEN}"},
            json={
                "files":      [{"id": d1["file_id"], "title": filename}],
                "channel_id": SLACK_CHANNEL_ID,
            },
            timeout=30,
        )
        d3 = r3.json()
        if not d3.get("ok"):
            print(f"  Slack complete error: {d3.get('error')}")
            return None
        permalink = d3.get("file", {}).get("permalink")
        print(f"  Audio uploaded to Slack: {permalink}")
        return permalink
    except Exception as exc:
        print(f"  Slack audio upload failed: {exc}")
        return None


def send_slack(
    filename: str,
    scores: list[dict],
    rubric_params: list[dict],
    agent_name: str | None = None,
    duration_seconds: float | None = None,
    file_permalink: str | None = None,
) -> None:
    if not SLACK_WEBHOOK:
        print("  Slack webhook not configured — skipping notification")
        return

    # Sort by rubric order → Call Opening first, Closing near end
    rubric_order  = {p["name"]: i for i, p in enumerate(rubric_params)}
    max_by_name   = {p["name"]: p["max_score"] for p in rubric_params}
    type_by_name  = {p["name"]: p.get("type", "numeric") for p in rubric_params}
    sorted_scores = sorted(scores, key=lambda s: rubric_order.get(s["parameter"], 999))

    total       = sum(s["score"] for s in sorted_scores)
    max_total   = sum(max_by_name.get(s["parameter"], 10) for s in sorted_scores)
    overall_pct = round(total / max_total * 100) if max_total else 0

    zone = (
        ":large_green_circle:"  if overall_pct >= 81 else
        ":large_yellow_circle:" if overall_pct >= 51 else
        ":red_circle:"
    )
    dur_str = f"{duration_seconds / 60:.1f} min" if duration_seconds else "—"

    lines = [
        f"{zone} *Call Audit — {filename}*",
        (
            f":bust_in_silhouette:  Agent: *{agent_name or 'Unknown'}*"
            f"   :stopwatch:  Duration: *{dur_str}*"
            f"   :bar_chart:  Overall: *{overall_pct}%*  ({total}/{max_total})"
        ),
        "",
    ]

    for s in sorted_scores:
        name  = s["parameter"]
        score = s["score"]
        mx    = max_by_name.get(name, 10)
        ptype = type_by_name.get(name, "numeric")

        if ptype == "yes_no" or mx == 2:
            val = "Yes  :white_check_mark:" if score == mx else "No  :x:"
            lines.append(f"*{name}*: {val}")
        elif ptype == "categorical" or mx == 3:
            label = _DEMO_LEVELS[min(score, len(_DEMO_LEVELS) - 1)]
            lines.append(f"*{name}*: {label}  `{score}/{mx}`")
        else:
            filled = "█" * score
            empty  = "░" * (mx - score)
            lines.append(f"*{name}*: {score}/{mx}  {filled}{empty}")

        if s.get("reasoning"):
            lines.append(f"  _{s['reasoning']}_")

    lines.append("")
    if file_permalink:
        lines.append(f":paperclip: *Recording:* {file_permalink}")

    requests.post(SLACK_WEBHOOK, json={"text": "\n".join(lines)}, timeout=10)


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    # Check if pipeline is paused via Supabase settings
    settings = supabase_client.table("settings").select("value").eq("key", "pipeline").execute()
    if settings.data and settings.data[0]["value"].get("paused"):
        print("Pipeline is paused from the dashboard — exiting.")
        return

    drive_svc = get_drive_service()

    rubric        = supabase_client.table("rubrics").select("*").eq("is_active", True).limit(1).execute().data[0]
    rubric_params = rubric["parameters"]
    print(f"Active rubric: {rubric['name']} ({len(rubric_params)} params)")

    processed = get_processed_drive_ids()
    all_files = list_drive_audio(drive_svc)
    new_files = [f for f in all_files if f["id"] not in processed]
    print(f"Drive files: {len(all_files)} total, {len(new_files)} new")

    for file in new_files:
        name = file["name"]
        fid  = file["id"]
        print(f"\n→ {name}")
        try:
            # 1. Download from Drive
            suffix = Path(name).suffix or ".mp3"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                dl   = MediaIoBaseDownload(
                    tmp,
                    drive_svc.files().get_media(fileId=fid),
                    chunksize=8 * 1024 * 1024,
                )
                done = False
                while not done:
                    _, done = dl.next_chunk()
                tmp_path = tmp.name
            print(f"  Downloaded: {os.path.getsize(tmp_path) // 1024} KB")

            # 2. Get audio duration (from file metadata, no API needed)
            duration_seconds = get_audio_duration(tmp_path)
            qualifies        = duration_seconds is not None and duration_seconds > SLACK_MIN_SECS

            # 3. Transcribe via Gemini
            transcript = transcribe(tmp_path, suffix)
            print(f"  Transcribed: {len(transcript.split())} words" + (
                f" · {duration_seconds / 60:.1f} min" if duration_seconds else ""
            ))

            # 4. Upload audio to Slack before deleting (only for qualifying calls)
            file_permalink = upload_audio_to_slack(tmp_path, name) if qualifies else None
            os.unlink(tmp_path)

            # 5. Save call to Supabase
            call_payload = {
                "drive_link": f"https://drive.google.com/open?id={fid}",
                "transcript": transcript,
                "status":     "transcribed",
                "metadata":   {"filename": name, "source": "auto-pipeline"},
                "source_row": 0,
            }
            if duration_seconds is not None:
                call_payload["duration_seconds"] = round(duration_seconds)
            call_row = supabase_client.table("calls").insert(call_payload).execute().data[0]
            call_id  = call_row["id"]

            # 6. Score via Gemini
            scores, agent_name = score_transcript(transcript, rubric_params, duration_seconds)
            print(f"  Scored: {len(scores)} params" + (f" · Agent: {agent_name}" if agent_name else ""))
            if agent_name:
                supabase_client.table("calls").update({
                    "metadata": {"filename": name, "source": "auto-pipeline", "agent_name": agent_name}
                }).eq("id", call_id).execute()

            # 7. Save scores — fill any parameters Gemini skipped with score 0
            scored_names = {s["parameter"] for s in scores}
            missing = [
                {"parameter": p["name"], "score": 0, "reasoning": ""}
                for p in rubric_params if p["name"] not in scored_names
            ]
            all_scores = scores + missing
            supabase_client.table("scores").upsert([
                {
                    "call_id":   call_id,
                    "rubric_id": rubric["id"],
                    "parameter": s["parameter"],
                    "score":     s["score"],
                    "max_score": next(
                        (p["max_score"] for p in rubric_params if p["name"] == s["parameter"]), 10
                    ),
                    "reasoning": s.get("reasoning", ""),
                }
                for s in all_scores
            ], on_conflict="call_id,rubric_id,parameter").execute()

            supabase_client.table("calls").update({"status": "done"}).eq("id", call_id).execute()

            # 8. Slack — only for calls > 3 minutes
            if qualifies:
                send_slack(name, scores, rubric_params, agent_name, duration_seconds, file_permalink)
                print("  Slack notified")
            else:
                info = f"{round(duration_seconds)}s" if duration_seconds else "unknown duration"
                print(f"  Slack skipped — {info} (< {SLACK_MIN_SECS}s threshold)")

            print(f"  ✓ Done")

        except Exception as exc:
            print(f"  ✗ Failed: {exc}")
            continue

    print("\nPipeline run complete.")


if __name__ == "__main__":
    main()
