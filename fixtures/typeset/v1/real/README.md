# Real newspaper corpus: BLOCKED (G0, P0-03)

**Status: BLOCKED.** No pilot material has been received yet. This directory defines the intake format so that material can be added the day it arrives.

## Intake rules
1. **Only authorised material.** A written permission reference (pilot memorandum of understanding) is required per batch.
2. **Confidential raw text stays out of git.** Store it in the private fixtures bucket. Keep here only `manifest.jsonl` with hashes and metadata:
   ```json
   {"id":"pilot-2026-11-03-p04-s2","source":"<pilot>","edition_date":"2026-11-03","page":4,"section":"city",
    "kind":"body|headline|caption|byline","lang":"mr","text_sha256":"…","storage":"s3://<private>/…",
    "permission_ref":"MoU-§4","font_used_in_print":"<family/version or unknown>","column_width_mm":null,
    "published_line_breaks_available":true,"notes":""}
   ```
3. **Also capture the published page geometry** where available. This means the PDF or a scan of the printed page, so L4 (story depth and line breaks compared against the original) can be computed.
4. **Never** edit received text. Corrections become a new derived record that points to the original.

## Minimum batch needed for G1
- 3–5 complete editions.
- About 200 body paragraphs across sections.
- About 30 headlines.
- Each one's printed column width and font, if known.
