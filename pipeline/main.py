"""
Automated call audit pipeline — runs on Cloud Run (no GPU needed).

Every execution:
  1. Lists audio files in the configured Google Drive folder
  2. Skips files already in Supabase
  3. Downloads new files → uploads to GCS → transcribes via Google STT
  4. Scores transcript using fine-tuned Gemini (no endpoint, direct API)
  5. Stores transcript + scores in Supabase
  6. Sends Slack message with parameter scores
"""
import json
import os
import re
import tempfile
from pathlib import Path

import requests
import vertexai
from google.api_core.exceptions import GoogleAPIError
from google.auth import default
from google.cloud import speech_v2, storage
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from vertexai.generative_models import GenerativeModel
import supabase as sb

# ── Config ────────────────────────────────────────────────────────────────────
DRIVE_FOLDER_ID = "1qAA2I00k827z55_4P2LUNyijgG-1-PxZ"
PROJECT_ID      = "call-audit-495917"
GCS_BUCKET      = "call-audit-495917-data"
TUNED_MODEL     = "projects/1018441713221/locations/us-central1/models/4149504656424304640@1"
SUPABASE_URL    = os.environ["SUPABASE_URL"]
SUPABASE_KEY    = os.environ["SUPABASE_KEY"]
SLACK_WEBHOOK   = os.environ.get("SLACK_WEBHOOK_URL", "")   # add later

SYSTEM_PROMPT = """You are a senior call-quality auditor evaluating customer-support call transcripts.
For every parameter in the rubric, output a score (integer) and 1-2 sentences of reasoning citing
specific moments in the transcript. Be strict and specific."""

# ── Clients ───────────────────────────────────────────────────────────────────
supabase_client = sb.create_client(SUPABASE_URL, SUPABASE_KEY)
vertexai.init(project=PROJECT_ID, location="us-central1")
gemini          = GenerativeModel(TUNED_MODEL)


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
            q=(f"'{DRIVE_FOLDER_ID}' in parents and "
               "(mimeType contains 'audio/' or mimeType contains 'video/')"),
            fields="nextPageToken, files(id, name, mimeType)",
            pageToken=page_token,
        ).execute()
        files.extend(resp.get("files", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return files


# ── Stage 2: Transcription ────────────────────────────────────────────────────
def transcribe(gcs_uri: str, speech_client) -> str:
    config = speech_v2.RecognitionConfig(
        auto_decoding_config=speech_v2.AutoDetectDecodingConfig(),
        language_codes=["en-IN", "en-AU", "en-GB"],
        model="chirp_2",
        features=speech_v2.RecognitionFeatures(
            enable_automatic_punctuation=True,
        ),
    )
    req = speech_v2.BatchRecognizeRequest(
        recognizer=f"projects/{PROJECT_ID}/locations/us-central1/recognizers/_",
        config=config,
        files=[speech_v2.BatchRecognizeFileMetadata(uri=gcs_uri)],
        recognition_output_config=speech_v2.RecognitionOutputConfig(
            inline_response_config=speech_v2.InlineOutputConfig(),
        ),
    )
    op       = speech_client.batch_recognize(request=req)
    response = op.result(timeout=600)

    parts = []
    for result in response.results.values():
        for r in result.transcript.results:
            if r.alternatives:
                parts.append(r.alternatives[0].transcript)
    return " ".join(parts).strip()


# ── Stage 3: Scoring ──────────────────────────────────────────────────────────
def build_prompt(rubric_params: list[dict], transcript: str) -> str:
    rubric_text = json.dumps(rubric_params, indent=2)
    return (
        SYSTEM_PROMPT
        + f"\n\n## Rubric\n{rubric_text}"
        + f"\n\n## Transcript\n{transcript}"
        + '\n\nReturn ONLY valid JSON: {"scores":[{"parameter":"...","score":N,"reasoning":"..."}, ...]}'
    )


def score_transcript(transcript: str, rubric_params: list[dict]) -> list[dict]:
    prompt   = build_prompt(rubric_params, transcript)
    response = gemini.generate_content(prompt)
    text     = response.text.strip()
    m        = re.search(r"\{[\s\S]*\}", text)
    if not m:
        raise ValueError(f"No JSON in model response: {text[:300]}")
    return json.loads(m.group(0)).get("scores", [])


# ── Stage 4: Slack ────────────────────────────────────────────────────────────
def send_slack(filename: str, scores: list[dict], rubric_params: list[dict]) -> None:
    if not SLACK_WEBHOOK:
        print("  Slack webhook not configured — skipping notification")
        return

    max_by_name = {p["name"]: p["max_score"] for p in rubric_params}
    total     = sum(s["score"] for s in scores)
    max_total = sum(max_by_name.get(s["parameter"], 10) for s in scores)

    lines = [f":phone: *Call Audit — {filename}*", ""]
    for s in scores:
        mx   = max_by_name.get(s["parameter"], 10)
        bar  = "█" * s["score"] + "░" * (mx - s["score"])
        lines.append(f"*{s['parameter']}*: {s['score']}/{mx}  {bar}")
        if s.get("reasoning"):
            lines.append(f"  _{s['reasoning']}_")
    lines += ["", f":bar_chart: *Total: {total}/{max_total}*"]

    requests.post(SLACK_WEBHOOK, json={"text": "\n".join(lines)}, timeout=10)


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    creds, _ = default(scopes=[
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/cloud-platform",
    ])
    drive_svc    = build("drive", "v3", credentials=creds)
    speech_client = speech_v2.SpeechClient()
    gcs_bucket   = storage.Client(project=PROJECT_ID).bucket(GCS_BUCKET)

    rubric        = supabase_client.table("rubrics").select("*").eq("is_active", True).limit(1).execute().data[0]
    rubric_params = rubric["parameters"]
    print(f"Active rubric: {rubric['name']} ({len(rubric_params)} params)")

    processed  = get_processed_drive_ids()
    all_files  = list_drive_audio(drive_svc)
    new_files  = [f for f in all_files if f["id"] not in processed]
    print(f"Drive files: {len(all_files)} total, {len(new_files)} new")

    for file in new_files:
        name = file["name"]
        fid  = file["id"]
        print(f"\n→ {name}")
        try:
            # 1. Download from Drive → upload to GCS
            suffix = Path(name).suffix or ".mp3"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                dl = MediaIoBaseDownload(tmp, drive_svc.files().get_media(fileId=fid), chunksize=8*1024*1024)
                done = False
                while not done:
                    _, done = dl.next_chunk()
                tmp_path = tmp.name

            gcs_blob = gcs_bucket.blob(f"audio/{fid}{suffix}")
            gcs_blob.upload_from_filename(tmp_path)
            gcs_uri  = f"gs://{GCS_BUCKET}/audio/{fid}{suffix}"
            os.unlink(tmp_path)
            print(f"  Uploaded to GCS: {gcs_uri}")

            # 2. Transcribe
            transcript = transcribe(gcs_uri, speech_client)
            print(f"  Transcribed: {len(transcript.split())} words")

            # 3. Save call + transcript to Supabase
            call_row = supabase_client.table("calls").insert({
                "drive_link": f"https://drive.google.com/open?id={fid}",
                "transcript": transcript,
                "status":     "transcribed",
                "metadata":   {"filename": name, "source": "auto-pipeline"},
                "job_id":     "auto-pipeline",
                "source_row": 0,
            }).execute().data[0]
            call_id = call_row["id"]

            # 4. Score with fine-tuned Gemini
            scores = score_transcript(transcript, rubric_params)
            print(f"  Scored: {len(scores)} parameters")

            # 5. Save scores to Supabase
            supabase_client.table("scores").upsert([
                {
                    "call_id":   call_id,
                    "rubric_id": rubric["id"],
                    "parameter": s["parameter"],
                    "score":     s["score"],
                    "max_score": next((p["max_score"] for p in rubric_params if p["name"] == s["parameter"]), 10),
                    "reasoning": s.get("reasoning", ""),
                }
                for s in scores
            ], on_conflict="call_id,rubric_id,parameter").execute()

            # 6. Slack
            send_slack(name, scores, rubric_params)
            print(f"  ✓ Complete: {name}")

        except Exception as exc:
            print(f"  ✗ Failed: {exc}")
            continue

    print("\nPipeline run complete.")


if __name__ == "__main__":
    main()
