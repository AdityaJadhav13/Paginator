# Legacy-encoding text corpus: framework ready, samples BLOCKED (P0-12)

**Status:** the framework is ready; samples are BLOCKED because no pilot files have been received. See `docs/architecture/v2/19` §2.

## Per-sample record (`samples.jsonl`)

Original bytes live in the private bucket. Git holds only this record.

```json
{"id":"leg-0001","source_org":"<pilot>","permission_ref":"…","received_at":"…",
 "original": {"sha256":"…","bytes":1234,"container":"docx|rtf|txt|pdf|indd-export|email|other","storage":"s3://<private>/…"},
 "source_software":"<e.g. PageMaker 7 / InDesign CS6 / MS Word 2010 / unknown>",
 "declared_font":"<e.g. Shree-Dev-0714>","font_name_in_file":"<from w:rFonts / \\fonttbl / PDF resources>",
 "encoding_family_guess":null, "encoding_version":null,
 "expected_unicode":{"text_sha256":null,"verified_by":null,"verified_at":null},
 "ambiguities":[], "conversion":{"converter":null,"version":null,"output_sha256":null,"confidence":null,
 "word_accuracy_vs_expected":null}}
```

## Evaluation (once samples exist)

**Detection accuracy** is measured on encoding families, using a confusion matrix.

**Conversion accuracy:**
- **Word-level:** exact match against `expected_unicode`. The target is ≥ 99.5%.
- **Silent-corruption rate:** words that are wrong but not flagged. The target is **0**.

**Confidence calibration:** the share of low-confidence words that are actually wrong.

**Round-trip visual similarity:** render the legacy text in its legacy font and the converted text in a Unicode font, then compare. This is reported, not gated.

**What not to conclude:** no converter is "solved" on fewer than 3 distinct source documents per encoding family, or on fewer than 2,000 words per family.
