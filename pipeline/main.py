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
import re
import tempfile
from datetime import datetime
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
SLACK_LIMIT      = 180   # notify if call > 3 minutes (OR specific conditions)
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

SCORE_CONTEXT = (
    "You are a strict call-quality auditor for SuperSheldon, an educational tutoring company "
    "operating in Australia and the UK. SuperSheldon sales agents (Indian accents) call parents "
    "to pitch tutoring services for their children. You score calls against a rubric."
)

# Sub-criteria per numeric parameter (key = normalized lowercase, trailing ? removed)
NUMERIC_CRITERIA: dict[str, list[tuple]] = {
    "call opening": [
        ("a", 2, "Agent stated their own first name in their opening utterance or within the first 15 seconds (e.g. 'Hi, I'm Priya')"),
        ("b", 2, 'Agent stated "SuperSheldon" as the company name within the first 30 seconds'),
        ("c", 2, "Agent addressed the parent by name within the first 30 seconds — e.g. said 'Is this [parent name]?' or used the parent's name directly"),
        ("d", 2, "Agent asked a social or wellness question such as 'How are you today?', 'Hope I'm not catching you at a bad time', or equivalent"),
        ("e", 2, "Agent did NOT confuse or stumble over their own name, the company name ('SuperSheldon'), or the parent's name — check the transcript for corrections, restarts, or wrong names"),
    ],
    "reason of call": [
        ("a", 2, "Agent used explicit words to state the reason for calling — e.g. 'I'm calling about', 'I'm reaching out regarding', 'I wanted to speak with you about' — AND linked it to the child's education or tutoring"),
        ("b", 2, "Agent mentioned the child specifically — by name, or as 'your son/daughter', 'your child' — BEFORE making any offer or pitch"),
        ("c", 2, "The reason for the call was fully communicated within the first 90 seconds of the call"),
        ("d", 2, "Agent did NOT open with a direct sales pitch or offer in the first statement; call was framed as informational or supportive first"),
        ("e", 2, "After stating the reason, agent explicitly confirmed the parent is the decision-maker for the child's education — DISTINCT from the name verification in Call Opening"),
    ],
    "customer need assessment": [
        ("a", 2, "Agent asked what year level or grade the child is currently in"),
        ("b", 2, "Agent asked which subject(s) the child is struggling with or needs help in"),
        ("c", 2, "Agent asked about the child's academic performance (grades, test results, teacher feedback)"),
        ("d", 2, "Agent asked whether the family already has any tutoring or support in place"),
        ("e", 2, "Agent listened and acknowledged responses before moving on — no rushing or interrupting"),
    ],
    "usp discussion": [
        ("a", 2, "Agent mentioned SuperSheldon's personalised or 1-on-1 teaching approach"),
        ("b", 2, "Agent mentioned the quality or experience of SuperSheldon's tutors"),
        ("c", 2, "Agent mentioned specific results or outcomes achieved by SuperSheldon students"),
        ("d", 2, "Agent linked at least one USP directly to the specific problem the parent described"),
        ("e", 2, "Agent differentiated SuperSheldon from generic tutoring alternatives"),
    ],
    "demo session pitch": [
        ("a", 2, "Agent explained what the demo session involves (format, duration, what to expect)"),
        ("b", 2, "Agent stated the demo is free or no-obligation"),
        ("c", 2, "Agent communicated a clear benefit or value proposition for attending the demo"),
        ("d", 2, "Agent made a direct, explicit ask to book a demo session"),
        ("e", 2, "Pitch was confident and clear — not rushed, mumbled, or overly tentative"),
    ],
    "closing": [
        ("a", 2, "Agent summarised agreed next steps clearly before ending the call"),
        ("b", 2, "Agent confirmed any booking, callback, or follow-up details (date, time, platform)"),
        ("c", 2, "Agent thanked the parent for their time"),
        ("d", 2, "Agent invited the parent to call back or ask questions if needed"),
        ("e", 2, "Call ended professionally — no abrupt hangup, trailing off, or unresolved confusion"),
    ],
}

BINARY_CRITERIA: dict[str, str] = {
    "call duration > 3 min": (
        "Use ONLY the duration from Call Metadata. Award YES if duration > 180 s. "
        "Award NO if ≤ 180 s or if no metadata was provided. Do NOT estimate from transcript length."
    ),
    "problem identified": (
        "Award YES only if the agent explicitly named or summarised a specific academic problem "
        '(e.g. "So Jake is struggling with Year 8 maths"). A vague reference to "needing help" '
        "or 'falling behind' does NOT qualify. Award NO if no specific problem was stated."
    ),
    "intent check done": (
        "Award YES only if the agent explicitly checked the parent's openness or interest before "
        'proceeding (e.g. "Does that sound like something you\'d be interested in?"). '
        "Simply continuing to pitch without checking is NOT sufficient. Award NO if no explicit intent check occurred."
    ),
    "price discussed": (
        "Award YES only if the agent mentioned a specific price, price range, or pricing model in "
        'dollar terms (e.g. "$X per session", "from $Y per week"). Vague references to '
        '"affordability", "investment", or "discuss pricing later" do NOT qualify.'
    ),
}

CATEGORICAL_CRITERIA: dict[str, dict[int, str]] = {
    "was demo scheduled": {
        0: "Agent did not mention or attempt to schedule a demo session at all.",
        1: "Agent mentioned or pitched a demo session but the parent explicitly declined.",
        2: "Parent agreed to a callback or follow-up to schedule a demo — no specific time confirmed.",
        3: "Demo session confirmed with a specific date and time during this call.",
    },
}


def _norm_key(name: str) -> str:
    import re
    return re.sub(r"\s*\?\s*$", "", name).lower().strip()


def _build_param_rubric(p: dict) -> str:
    key = _norm_key(p["name"])
    binary = BINARY_CRITERIA.get(key)
    categorical = CATEGORICAL_CRITERIA.get(key)
    numeric = NUMERIC_CRITERIA.get(key)

    if binary:
        return (
            f"PARAMETER: \"{p['name']}\"\nTYPE: BINARY YES/NO (YES = {p['max_score']} pts, NO = 0 pts)\n"
            f"CRITERION: {binary}\n"
            f"REASONING FORMAT: \"EVIDENCE: '[exact quote]' | VERDICT: YES/NO | SCORE: {p['max_score']} or 0\""
        )
    if categorical:
        levels = "\n".join(f"  {k} — {v}" for k, v in categorical.items())
        return (
            f"PARAMETER: \"{p['name']}\"\nTYPE: CATEGORICAL (0–{p['max_score']})\n"
            f"LEVELS:\n{levels}\n"
            f"REASONING FORMAT: \"EVIDENCE: '[exact quote or NO EVIDENCE]' | LEVEL CHOSEN: N | SCORE: N\""
        )
    if numeric:
        lines = "\n".join(f"  [{cid}] +{pts} pts — {desc}" for cid, pts, desc in numeric)
        return (
            f"PARAMETER: \"{p['name']}\"\nTYPE: NUMERIC (0–{p['max_score']})\n"
            f"SUB-CRITERIA (sum points for each YES):\n{lines}\n"
            f"REASONING FORMAT: \"EVIDENCE: '[exact quote or NO EVIDENCE]' | [a] YES/NO [b] YES/NO ... | SCORE: N\""
        )
    desc = f"\nDESCRIPTION: {p['description']}" if p.get("description") else ""
    return f"PARAMETER: \"{p['name']}\"\nTYPE: NUMERIC (0–{p['max_score']}){desc}"

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


def parse_filename_datetime(name: str) -> datetime | None:
    """Parse datetime from filenames like 2026-02-16T12-18-35AM-...

    Returns a naive datetime in local recording time, or None if unparseable.
    """
    m = re.match(
        r"(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})(AM|PM)",
        name,
        re.IGNORECASE,
    )
    if not m:
        return None
    year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
    hour, minute, second = int(m.group(4)), int(m.group(5)), int(m.group(6))
    ampm = m.group(7).upper()
    if ampm == "AM" and hour == 12:
        hour = 0
    elif ampm == "PM" and hour != 12:
        hour += 12
    try:
        return datetime(year, month, day, hour, minute, second)
    except ValueError:
        return None


def list_drive_audio(drive_svc) -> list[dict]:
    """Recursively walk the Drive folder hierarchy and return all audio files.

    Expected structure:
      <root> / Daily_Backups / recordings / <year> / <month> / <day> / <hour> / file.mp3
    """
    audio_files: list[dict] = []
    AUDIO_EXTS = set(MIME_MAP.keys())

    def _walk(folder_id: str, path: str = "") -> None:
        page_token = None
        while True:
            resp = drive_svc.files().list(
                q=f"'{folder_id}' in parents and trashed = false",
                fields="nextPageToken, files(id, name, mimeType)",
                pageToken=page_token,
                pageSize=1000,
            ).execute()
            for item in resp.get("files", []):
                if item["mimeType"] == "application/vnd.google-apps.folder":
                    _walk(item["id"], f"{path}/{item['name']}")
                else:
                    mime = item["mimeType"]
                    ext  = Path(item["name"]).suffix.lower()
                    if mime.startswith("audio/") or mime.startswith("video/") or ext in AUDIO_EXTS:
                        item["_path"] = f"{path}/{item['name']}"
                        audio_files.append(item)
            page_token = resp.get("nextPageToken")
            if not page_token:
                break

    _walk(DRIVE_FOLDER_ID)
    print(f"Drive walk complete — {len(audio_files)} audio files found")
    return audio_files


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
    if duration_seconds is not None:
        mins   = int(duration_seconds // 60)
        secs   = round(duration_seconds % 60)
        longer = "YES" if duration_seconds > 180 else "NO"
        meta_section = (
            f"\n## CALL METADATA\n"
            f"Duration: {mins}m {secs}s ({round(duration_seconds)}s total) — "
            f"Longer than 3 minutes: {longer}"
        )
    else:
        meta_section = "\n## CALL METADATA\nDuration: not available"

    rubric_section = "\n\n".join(_build_param_rubric(p) for p in rubric_params)

    return (
        SCORE_CONTEXT + "\n\n"
        "## MANDATORY SCORING PROCESS — follow for EVERY parameter\n"
        "You MUST work through these steps in order for each parameter. Do not skip any step.\n\n"
        "  STEP 1 — EXTRACT: Find and quote the exact words from the transcript relevant to this parameter.\n"
        "            If nothing relevant was said, write \"NO EVIDENCE FOUND\".\n"
        "  STEP 2 — CHECK: Evaluate each sub-criterion using ONLY the extracted quote.\n"
        "            Answer YES or NO for each. Do not infer, assume, or give credit for implied behaviour.\n"
        "  STEP 3 — SCORE: Derive the score mechanically from Step 2 (sum of YES points, or binary verdict).\n"
        "            The score must follow directly from Step 2 — do not adjust based on overall call feel.\n\n"
        "  STEP 4 — IMPROVEMENT: If the score is less than the maximum possible score for this parameter, suggest 1-2 specific, actionable areas where the agent can improve, referencing the transcript. If the score is perfect, write \"Perfect execution.\".\n\n"
        "Place the output of all four steps in the \"reasoning\" field of each score entry.\n\n"
        "## ABSOLUTE RULES\n"
        "1. Score ONLY what is LITERALLY SAID. Never award credit for likely, implied, or probable behaviour.\n"
        "2. Ambiguous or unclear evidence → score the LOWER possibility (conservative scoring).\n"
        "3. BINARY parameters: score is EITHER 0 OR the full max — NEVER anything in between.\n"
        "4. Call Duration: use ONLY the provided Call Metadata — NEVER estimate from transcript length.\n"
        f"5. You MUST score all {len(rubric_params)} parameters. If something did not happen, score it 0.\n"
        "6. Agent name: extract from the agent's self-introduction only. Use null if not heard.\n"
        + meta_section + "\n\n"
        "## PARAMETER RUBRICS\n"
        + rubric_section + "\n\n"
        "## CALL TRANSCRIPT\n"
        + transcript + "\n\n"
        "## RESPONSE FORMAT\n"
        "Respond ONLY with valid JSON — no markdown fences, no extra text:\n"
        '{"agent_name":"<first name or null>","scores":[{"parameter":"<exact parameter name>","score":<integer>,"reasoning":"<EVIDENCE: \'...\' | sub-criteria results | SCORE: N | IMPROVEMENT: ...>"}]}\n'
        f"You must return exactly {len(rubric_params)} score objects — one per parameter above, using the exact parameter name shown."
    )


def score_transcript(
    transcript: str,
    rubric_params: list[dict],
    duration_seconds: float | None = None,
) -> tuple[list[dict], str | None]:
    prompt = build_prompt(rubric_params, transcript, duration_seconds)
    text   = gemini_post({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0},
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
            reasoning = s["reasoning"]
            imp_idx = reasoning.find("| IMPROVEMENT:")
            improvement = None
            main_part = reasoning

            if imp_idx != -1:
                improvement = reasoning[imp_idx + 14:].strip()
                main_part = reasoning[:imp_idx].strip()
            
            evidence = None
            cleaned_main = main_part.replace("[OVERRIDE]", "").strip()
            if cleaned_main.startswith("EVIDENCE:"):
                pipe_idx = cleaned_main.find("|")
                if pipe_idx != -1:
                    evidence = cleaned_main[9:pipe_idx].strip()
                else:
                    evidence = cleaned_main[9:].strip()
            
            if improvement:
                lines.append(f"  💡 _{improvement}_")
            if evidence and evidence != "'NO EVIDENCE FOUND'":
                lines.append(f"  📝 _{evidence}_")
            if not improvement and not evidence:
                lines.append(f"  _{reasoning}_")

        lines.append("")

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
        path = file.get("_path", name)
        print(f"\n→ {path}")
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
            
            # 3. Transcribe via Gemini
            transcript = transcribe(tmp_path, suffix)
            print(f"  Transcribed: {len(transcript.split())} words" + (
                f" · {duration_seconds / 60:.1f} min" if duration_seconds else ""
            ))

            # 4. Score via Gemini
            scores, agent_name = score_transcript(transcript, rubric_params, duration_seconds)
            print(f"  Scored: {len(scores)} params" + (f" · Agent: {agent_name}" if agent_name else ""))

            # 5. Determine if it qualifies for Slack AUTOMATICALLY
            # Criteria: Duration > 3 minutes (SLACK_LIMIT)
            qualifies = duration_seconds is not None and duration_seconds > SLACK_LIMIT

            # 6. Upload audio to Slack before deleting (only for qualifying calls)
            file_permalink = upload_audio_to_slack(tmp_path, name) if qualifies else None
            os.unlink(tmp_path)

            # 7. Save call to Supabase
            recorded_dt = parse_filename_datetime(name)
            metadata = {
                "filename":    name,
                "source":      "auto-pipeline",
                "drive_path":  path,
            }
            if recorded_dt:
                metadata["recorded_at"]   = recorded_dt.isoformat()
                metadata["recorded_date"] = recorded_dt.strftime("%Y-%m-%d")
                metadata["recorded_time"] = recorded_dt.strftime("%I:%M:%S %p")
                print(f"  Recorded: {recorded_dt.strftime('%d %b %Y %I:%M %p')}")

            call_payload = {
                "drive_link": f"https://drive.google.com/open?id={fid}",
                "transcript": transcript,
                "status":     "transcribed",
                "metadata":   metadata,
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
                    "metadata": {**metadata, "agent_name": agent_name}
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
                print(f"  Slack skipped — {info} (did not meet auto-notify criteria)")

            print(f"  ✓ Done")

        except Exception as exc:
            print(f"  ✗ Failed: {exc}")
            continue

    print("\nPipeline run complete.")


if __name__ == "__main__":
    main()
