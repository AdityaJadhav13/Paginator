# 17 — Press Requirements Questionnaire

Status: READY FOR USE. **Do not pre-fill any answer with assumptions.** Record "unknown" when the press does not know, and note who to ask instead.

**How to use it.** Take this to the pilot newspaper's printing press. Ask for the prepress or CTP manager, not sales. Bring a laptop, ask to see their preflight software, and ask for sample files they have accepted. Expect about 60–90 minutes. Attach every document they give you.

| Field | Answer |
|---|---|
| Press / printing centre name |  |
| Location(s) / printing centres used by the pilot |  |
| Contact (prepress / CTP) — name, phone, email |  |
| Date of interview / interviewer |  |
| Press owned by the newspaper? (in-house / contract printer) |  |
| Documents received (spec PDF, preflight profile, sample files) |  |

---

## A. Workflow and equipment
A1. Press make and model (e.g. Manugraph, Orient, Goss, Wifag, KBA) and configuration (number of towers, colour units per page position).
A2. Prepress / CTP system (e.g. Agfa Arkitex/Advantage, Kodak Prinergy, ECRM, Fujifilm, Screen, other). RIP name and version.
A3. Do you run your own preflight on incoming pages? Which software, which version, which profile? **Can we have the exact profile file?** (PitStop `.ppp`, pdfToolbox `.kfpx`, Acrobat preflight profile, or other)
A4. Plate output: CTP, CTCP or film? Plate size? Pages per plate?
A5. Who imposes pages — you (RIP or imposition software) or the publisher? If the publisher, describe the required page order and signatures.
A6. Typical number of pages per edition, sections, and how editions or zones (city editions) are handled at the press.
A7. Paper: newsprint grade and weight (gsm), brightness. Any colour-enhanced or improved newsprint?

## B. File format
B1. Accepted PDF standards (tick all that apply and mark the preferred one): ☐ PDF/X-1a:2001 ☐ PDF/X-1a:2003 ☐ PDF/X-3 ☐ PDF/X-4 ☐ "any PDF" ☐ other: ___
B2. Maximum PDF version accepted.
B3. One PDF per page, or a multi-page PDF? If per page, what is the exact file-naming convention? (Example of a real accepted file name.)
B4. Are spreads (double-truck/centre spread) supplied as one file or two halves?
B5. Do you accept live transparency, or must it be flattened?
B6. Are layers or optional content allowed?
B7. Maximum file size per page.
B8. Do you reject files with annotations, form fields, JavaScript or embedded files?

## C. Page geometry
C1. Trim size (width × height, mm) of each product: broadsheet, tabloid supplement, others.
C2. Bleed required? How much on each side? (Many newspaper presses use none; confirm.)
C3. Safety margin from trim for live matter.
C4. Should TrimBox, BleedBox and MediaBox be set? Are crop or registration marks wanted, tolerated or forbidden?
C5. Slug or information line: wanted, tolerated or forbidden? Required content (date, page, edition, colour)?
C6. Column grid, if the press has any requirement for it (normally the publisher's choice).
C7. Page orientation and rotation expectations.

## D. Colour
D1. Output intent / ICC profile expected: ☐ ISOnewspaper26v4 ☐ WAN-IFRAnewspaper26v5 ☐ IFRA30 ☐ press-specific (please provide file) ☐ none or unsure
D2. **Total ink coverage (TAC) limit, %.** (Do not assume. 26v5 is 220%; older profiles differ.)
D3. Black text: must it be 100% K only? Is overprint of black required, preferred or forbidden? Minimum text size for 4-colour (rich black) text?
D4. Rich black for large areas: allowed? Specific recipe (e.g. C40 M30 Y30 K100)?
D5. RGB objects: rejected, or converted by you? Which profile and rendering intent do you use if you convert?
D6. Spot colours: allowed? Converted? Any standard spot (e.g. a masthead red)?
D7. Black-and-white (mono) pages: grayscale only? Is CMYK with only K acceptable?
D8. Dot gain / tone value increase your plates expect. Do you apply your own curves?
D9. Minimum dot / highlight dot and maximum dot that holds on your press.
D10. Which pages or positions are colour versus mono per edition? Who decides, and how is it communicated (colour plan / page plan)?
D11. How are images expected to be prepared (sharpening, highlight/shadow handling)? Any house recipe?

## E. Images
E1. Minimum effective resolution for photos (ppi at 100% placed size). Preferred resolution.
E2. Maximum resolution (downsampling expectations).
E3. Line art / bitmap images: resolution and mode.
E4. Accepted image compression inside PDF (JPEG quality, ZIP).
E5. 16-bit images, JPEG2000, embedded ICC in images: accepted?

## F. Fonts
F1. All fonts must be embedded? Subset allowed?
F2. **Are TrueType-based fonts (CIDFontType2) accepted by your RIP?** Any history of problems with TrueType or OpenType fonts? (Some ad specifications forbid TrueType.)
F3. Are OpenType CFF (CIDFontType0) fonts accepted?
F4. Any known problems with Devanagari text in incoming PDFs (missing conjuncts, wrong glyphs)? Which fonts are used by publishers you print?
F5. Do you ever replace or convert fonts? (You should not; confirm.)
F6. Minimum font size / line weight that prints reliably (positive and reversed out).

## G. Advertisements
G1. Do advertisements arrive at the press separately, or always inside publisher pages?
G2. If you receive ads directly: formats and specifications you enforce.
G3. Common problems you see with ad files (RGB, low resolution, missing fonts, wrong size, transparency).
G4. Who is responsible when an ad fails at the press?

## H. Delivery and timing
H1. How are pages delivered today? ☐ FTP ☐ SFTP/FTPS ☐ hot folder on LAN/VPN ☐ email ☐ web portal ☐ CTP vendor portal/workflow ☐ physical media ☐ other
H2. Exact technical details (host, folder structure, credentials process, VPN, IP allowlisting). Is there a separate test folder or queue?
H3. Do you send a receipt or acknowledgement (automatic email, preflight report, status file)? Format?
H4. Page deadlines: first page, last page, per-section deadlines. Typical lateness. What happens when the deadline is missed?
H5. Replacing a page after delivery: how? (Re-send with suffix? Phone call?) Cut-off for replacements.
H6. Multiple printing centres: same files sent to each? Who distributes?
H7. Contingency: if the publisher's system fails, what do you accept (e.g. PDF on USB, email)?

## I. Rejections and quality control
I1. The 5 most common reasons you reject or fix publisher pages.
I2. What do you fix silently versus return to the publisher?
I3. Can you share examples of rejected files and the reports? (With identifying content removed if needed.)
I4. Do you produce a proof (soft proof, hard proof, plate preview) for the publisher? Can we receive it for test pages?
I5. Willingness to accept **test pages** from Pageinator before go-live: how many, when, through which channel, with written confirmation of acceptance?
I6. Who signs off a test page as "acceptable for production"?

## J. Anything else
J1. Special products (jackets, wraps, gatefolds, supplements, inserts) and their specifications.
J2. Planned changes (new press, new CTP, new profile) in the next 12 months.
J3. Anything new publishers typically get wrong.

---

## Recording results
- Store the completed form and attachments at `docs/knowledge/press/<press-slug>/` (or the private bucket if confidential).
- Turn the answers into a `PrintProfile` draft. Every value must cite the question it came from (for example `D2 → tac_limit_pct`).
- Unknown answers become blocking items for Gate 2.
