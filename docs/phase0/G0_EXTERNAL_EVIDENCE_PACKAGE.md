# Part 13: G0 External Evidence Package

**Status:** READY TO USE. **Nothing here is answered yet. Do not pre-fill answers.** Record "unknown" with who can answer.

This package covers what we need from four groups:
1. the pilot newspaper;
2. the printing press;
3. legal counsel;
4. Marathi typography reviewers.

## 1. Pilot memorandum of understanding (P0-00): points to agree

| # | Point |
|---|---|
| 1 | A named production contact and an executive sponsor |
| 2 | Permission to use 3–5 published editions, with their source stories, photos, ads and font metadata, as **private** test fixtures. No redistribution. Deleted on request |
| 3 | Two **shadow nights**, where Pageinator runs in parallel and the paper's own workflow stays authoritative, and one test print run |
| 4 | Paid review sessions with 2 sub-editors and 1 page designer (G1 protocol) |
| 5 | An introduction to their printing press and its prepress contact |
| 6 | Confidentiality both ways. Unpublished content is never used for anything but the pilot. AI processing is off unless agreed in writing |
| 7 | Data handling: where material is stored (a private bucket in India), retention, and deletion at the end of the pilot |

## 2. Pilot newspaper questions (interview, about 90 minutes, editor plus production head)

**A. Organisation and output**
- Titles, languages, editions and zones.
- Days published and page counts on weekdays and weekends.
- Supplements.
- Typical sections and page order.

**B. Current workflow and software**
- Who does what between 10:00 and 01:00?
- Software used: DTP (InDesign, QuarkXPress, PageMaker, other), editorial system, wire intake, Marathi typing tool (Shree-Lipi, ISM, Google Input, InScript or phonetic).
- Versions and the operating system.

**C. Fonts**
- Body, headline and caption fonts: names, versions, vendor.
- **Unicode or legacy-encoded?**
- Licence type (per machine, server) and licence documents.
- Would they switch body fonts?

**D. Typography practice (key for G1)**
- Do Marathi body columns justify? Any sections run ragged?
- Do you ever break words at line ends? With a hyphen?
- Is letter-spacing ever used to fit lines?
- What makes a line "bad"?
- Body size, leading and column widths. Get the grid spec if it exists.

**E. Ads**
- How ads arrive (formats, who sends them, when).
- Cut-off times.
- Common problems.
- Who checks them, and how.

**F. Deadlines**
- Page-by-page deadline schedule; late-news process; how often pages are replaced after sending.

**G. Bottlenecks**
- Where time goes each night.
- The three worst recurring problems.
- What a "bad night" looks like.

**H. Archive**
- How past editions are stored and retrieved today.
- Legal or retention requirements they know of.

**I. Staff and roles**
- Headcount by role on a production night; who approves pages.

**J. IT and hardware**
- Typical desk PC (CPU, RAM, GPU, OS, browser).
- Network: connection type, speed, failover.
- Server room or cloud use.
- IT restrictions, such as blocked sites or installation policies.

## 3. Newsroom observation protocol (P0-02; 2 nights)
1. **Shadow** the production desk from first page make-up until the last page is sent.
2. **Time-stamp every page event:** started, story placed, ads placed, revisions, proof, approval, sent to press, replaced.
3. **For 3 pages, record the work in detail:** each operation and its duration, which tool, and what failed. This is the baseline for G5.
4. **Hardware inventory** (spec sheets or a system-info screenshot) for 3 typical desks.
5. **Network measurement** from 2 desks, at different hours (peak deadline and off-peak), with consent:
   - RTT and jitter to the candidate cloud regions (100 samples each, HTTPS);
   - download and upload throughput.

   These results feed **P0-14** and the latency experiment's S5.
6. **Deliverable:** a baseline report recording person-minutes per page and per edition, error and rework counts, and deadline slips.

## 4. Sample requests (with confidentiality and licensing)

| # | Sample | Purpose | Handling |
|---|---|---|---|
| S1 | 3–5 complete printed editions (physical plus the PDFs sent to press) | Real corpus, L4 reference, words per line, published spacing | Private bucket; hashes in git |
| S2 | The source stories for those editions (as filed) | Corpus, legacy detection | Private |
| S3 | Representative photos (10–20) with captions and credits | Image pipeline tests | Private; never redistributed |
| S4 | Ads as received (2 weeks of real files, including problem ones) | P0-13 ad intake requirements | Private; advertiser material is confidential |
| S5 | Font list plus licence documents (and the font files **only if their licence permits sharing with us**) | P0-11 font rights; set-width realism | Font files only into a controlled environment |
| S6 | Legacy-encoded text files (Shree-Lipi or other), with the font used | P0-12 legacy conversion | Private; original bytes preserved |
| S7 | The press's print profile / ICC / preflight profile | PrintProfile | Per the press's terms |
| S8 | One **rejected** PDF and the rejection reason, if available | Negative fixture | Private |
| S9 | One **accepted** PDF from their current workflow | Positive reference for structure | Private |

**Rules for every sample:**
- A written permission reference.
- Storage location recorded.
- Deletion on request.
- No AI processing without written consent.
- No use outside the pilot.

> **Intake for S1, S5, S7–S9:** follow `EXP_PUBLISHED_1.md` §3–§4. Store files privately under `$PAGEINATOR_PRIVATE_CORPUS`, never in git, and fill in a provenance manifest for each sample.

## 5. Font rights questions (P0-11)

**To the pilot:**
- Which fonts?
- Bought from whom?
- Licence documents, and seat or server counts.

**To the font vendors (for example Modular Infotech for Shree-Lipi, or C-DAC/ISM):** six questions.
1. Can a SaaS vendor run the font on its own servers to compose the customer's pages (server use)?
2. May glyph outlines or rendered previews be shown in the customer's browser?
3. Does the licence permit embedding subsets in print PDFs (embedding level)?
4. May the font be retained for archive re-editing?
5. Is a Unicode/OpenType edition of the same design available?
6. What do server or SaaS licences cost?

## 6. Legal review questions (counsel)

| ID | Question |
|---|---|
| L1 | AGPL-3.0 Ghostscript/MuPDF: obligations if used unmodified as separate processes in a SaaS; alternatives (Artifex licence) |
| L2 | Font EULAs: server use, outline or raster preview in browsers, PDF embedding, archive retention, vendor custody |
| L3 | Redistribution terms of ICC profiles (WAN-IFRA, ECI, press-supplied) |
| L4 | callas / PitStop licensing for multi-tenant SaaS use |
| L5 | **DPDP Act and Rules 2025:** our role (processor vs fiduciary); the missing journalism exemption; archive and byline erasure requests; cross-border AI processing; breach notification process and timelines |
| L6 | Wire-service licences (PTI, IANS): storage, AI processing and archive rights |
| L7 | libheif/HEVC patent exposure |
| L8 | Customer terms and data processing agreement templates; liability for missed print deadlines |
| L9 *(new)* | Pilot MoU terms for using published editions as private test fixtures, and paying the pilot's staff as reviewers |
| L10 *(new)* | Licence of the `hyph-mr` hyphenation patterns, if adopted |

## 7. Marathi typography reviewers
- **Recruit** per `G1_ACCEPTANCE_PACKAGE.md` §7.1: 2 sub-editors, 1 page designer, and an optional proofreader.
- **Agree up front:**
  - paid sessions;
  - two sessions of 3–4 hours each (calibration plus rating, and later a re-review);
  - confidentiality.
- **Ask them in advance for** 5 house examples of acceptable copy and 5 of unacceptable copy, for calibration.

## 8. Press
- Use `../architecture/v2/17_PRESS_REQUIREMENTS_QUESTIONNAIRE.md` as is.
- **Bring:** a laptop, permission to photograph their preflight settings, and a request for sample files (S7–S9).
