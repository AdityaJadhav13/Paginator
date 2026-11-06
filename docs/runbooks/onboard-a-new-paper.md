# Onboard a new paper (our review, L4 step O7)

A new paper learns its design from its own past editions in the hosted app ("Set up your paper's design" on the
Templates and Engine profile screens). Everything the app does is deterministic: no AI reads the grid, chooses the
templates, fits stories or decides validity. This runbook is the part a person does. Plan: 1–2 hours of our time a
paper. Background: `docs/product/09-launch-plan.md` §L4, and the steps O1–O6 it lists.

**Gate first.** Other papers may be offered the product only after G3 (`docs/architecture/v2/13`). Until then this
runbook is used for test papers and the pilot only. Nothing on the website may say "any paper", "English",
"press-ready" or "PDF/X-valid" for a new paper until it is proven on that paper (CLAUDE.md, "No unproven claims").

## 1. Before the paper gets an account

1. **Approval by hand.** A new paper applies on `/signup` (paper name, owner, email, language) and confirms its email;
   the application then waits. Nothing is created until an operator decides, after a call with the paper's owner (who
   they are, their press, how many pages they print):
   `pnpm --filter @pageinator/api review-paper -- list` (waiting applications), then
   `review-paper -- approve <id> [--slug s] --by "Your name"` (makes the organisation, the Owner and the first
   publication through the bootstrap, audited, and emails the Owner) or `review-paper -- refuse <id> [reason] --by "…"`.
   Who decided and when is kept on the application. On the pilot's app host there is no pnpm: run the same script in
   the API's image, as `deploy.md` runs `bootstrap-org.ts` (`PGN_IMAGE_TAG` from `deploy.sh status`):
   `sudo PGN_IMAGE_TAG=<tag> docker compose -p pageinator-pilot --profile pilot --env-file /etc/pageinator/pilot.env
   -f infra/docker/compose.pilot.yml run --rm --no-deps api node scripts/review-paper.ts list` (then `approve …` or
   `refuse …` in place of `list`).
2. **Their paper is theirs.** Get the paper's permission to process its archive in writing (the DPA and terms). In the
   app, the owner also ticks the permission box before uploading; the onboarding row records who and when.
3. **Ask for the right files:** 12–20 whole editions over at least 3 weeks, all in the current design, including
   editions whose back page carries ads. The PDFs the page-making program exported for the press (not scans, not
   e-paper exports), fonts embedded. At least 3 editions; at most 40 files of 200 MiB each.

## 2. While it runs

The owner uploads the PDFs and the engine checks each file first. A file is left out, with its reason shown in English
and Marathi, when it is a scan, its fonts are missing or Type 3, its words cannot be read (legacy non-Unicode Marathi
fonts), its pages are a different size from the rest, it repeats another edition, or it has no date. A program other
than InDesign is accepted with a warning ("made with an untested program").

**Our follow-up, per code:**

| What the owner sees | What we do |
|---|---|
| "We cannot read the words in this file's fonts" (`onboard.no_unicode`) | Ask for the font names. A legacy font needs a mapping we have not built: the paper cannot be onboarded yet. Note it for the font work |
| "Made with an untested program" (`onboard.untested_program`) | Look harder at the test pages in §3; record the program |
| "A person from Pageinator will look at it" (`onboard.too_many_excluded`) | Open the job's report: which files lost the most frames, and why. Usually a font or export problem: ask for a new export |
| Failed (`onboard.failed`, `worker.*`) | Read the worker log for the job; fix or ask for other files |

## 3. Our review of the result (about 1 hour)

Open the onboarding result on the Templates screen, then:

1. **The house profile in brief:** the page size, the column grid (columns, column width, gutter) against a printed
   page with a ruler; the main script; "more than one grid seen" means the paper uses several and we took the most
   common: check that it is the main one. The excluded share should be small (a few per cent).
2. **The templates the engine chose** (front, page 2 with the imprint, inside, back): each from the paper's newest
   design. Choose another candidate on the Templates screen if one is better.
3. **The test layout:** "Make a test layout" makes an edition of fictional sample stories and lays it out. Open each
   page side by side with the paper's own printed page: masthead, folio, imprint, rules, column grid, headline sizes,
   body size. Note what differs.
4. **Font licences:** the engine sets type in free stand-in fonts (OFL). The paper's own fonts are not used until
   per-paper font storage and the licence check exist (09 §5 "House fonts").
5. **The press:** one test page through the paper's own press, with its ICC (a G2 for that press). Until it passes,
   the paper prints from its own system.

Record the outcome (date, who, the grid, the templates, what differed, the press test) in the paper's private folder,
not in this repository.

## 4. What this does not prove

- Only fictional papers and the pilot have been run through it. Another real paper's PDFs (other programs, legacy
  fonts, no ActualText, several grids, broadsheet section fronts) may fail or give poor templates: the review above is
  there to catch that.
- The intake checks and the automatic exclusions are rules with fixed thresholds, tuned on the pilot and fictional
  papers.
