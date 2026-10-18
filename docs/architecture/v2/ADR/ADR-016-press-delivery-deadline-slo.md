# ADR-016: Press delivery and the deadline-night SLO

**Post-review status (2026-10-07):** **ACCEPTED** for the deadline SLO, extended by ADR-020. **CHANGED:** build only the pilot's actual delivery mechanism, from questionnaire `17` §H. Manual download comes first. SFTP is not assumed.

_Original text (2026-10-07, pre-review) follows unchanged; its "DECIDED" wording is superseded by the status block above (ADR-021)._


**Status:** DECIDED.

## Press delivery
- Delivery targets are configured per publication: SFTP/FTPS hot folder, email link, or manual download.
- Delivered files follow a naming template.
- Each delivery records a receipt containing the time, the file list and the file hashes.
- Failed deliveries are retried and raise alerts.
- Late corrections re-deliver only the pages that changed.

## Deadline-night SLO
The deadline window is 18:00 to 02:00 IST. Within it:
- export and preflight jobs start within 30 s (p95);
- 99% of them finish within budget.

## Measures that protect the deadline
- Separate batch worker pools, with deadline-aware priority.
- The last good export for each page.
- A manual-export CLI runbook.
- On-call cover during pilot nights.
- A load test at 3× expected volume before each pilot goes live.
