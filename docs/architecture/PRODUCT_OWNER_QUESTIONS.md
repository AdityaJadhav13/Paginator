# Product-owner questions — Phase 20

Prepared 2026-09-16 after reading the decision register and adversarial review. Only answers that change scope, workflow, customer/commercial commitments or architecture are requested here. These are recorded for a later owner decision session; they do not pause this documentation program. No owner answer has been assumed.

BLOCKING means blocking the specified production commitment, not the fictional UI-first demonstration. The latter can proceed after separate implementation authorization using explicitly provisional fixtures. There are **5 BLOCKING questions**, **5 IMPORTANT questions**, and **1 CAN DEFER question**. Technical choices such as PDF library, numerical scale or queue are research/engineering responsibilities, not questions delegated to the owner.

## BLOCKING

| ID | Question | Why the answer changes the plan | Decision / required before | Provisional treatment, not assumed answer |
|---|---|---|---|---|
| PO01 | Which first customer/segment and concrete daily edition workflow must the pilot serve, and who will accept its results? | A regional daily with multiple deadline editions differs materially from a small weekly; determines essential roles, formats and success criteria. | OP01; production pilot scope freeze | Fictional regional-newspaper fixtures only; no customer fit claim |
| PO02 | Which languages and approved typefaces must work in the first pilot, and who can supply representative licensed material and native-language sign-off? | Determines the first font/language corpus and quality gate without removing eventual English/Hindi/Marathi/Urdu support. | OP02/RD02; typography qualification | Mixed-script UI examples are demonstrations, not qualified typography |
| PO03 | Which printing press will validate the pilot, and can it supply its required input specification, profiles and handoff/imposition responsibilities? | Defines the real output target and physical acceptance process; generic PDF/X branding is insufficient. | OP03/RD03; writer/profile commitment | Single reader-order pages and manual handoff are proposals only |
| PO04 | Are commercial PDF/preflight engines acceptable, and what procurement/support budget or constraints should the comparison respect? | A required professional engine may need OEM/SaaS/concurrency terms; rejecting commercial licensing changes cost/risk and may delay production feasibility. | OP04/RD01/RD03; technology procurement | Compare open-source and commercial routes; no purchase or free equivalent assumed |
| PO05 | What archive promise should customers buy: retention duration, exact-file access after cancellation, editable restoration and later reprint rights—and what exceptions are acceptable? | Determines retention/hold/deletion, dependency licensing, storage liability and whether restoration can be honestly sold. | OP05/RD04; archive contract/storage-lock selection | No “permanent” or unconditional editable recovery promise |

## IMPORTANT

| ID | Question | Material consequence | Decision / required before |
|---|---|---|---|
| PO06 | Must several people edit the same edition/page/story simultaneously in the pilot, or is coordinated checkout/assignment acceptable? | Changes conflict, lease and linked-flow editing design; do not select CRDTs without this workflow need. | OP06; production editor specification |
| PO07 | Will the pilot contain confidential/embargoed stories, restricted sources or customer contractual data-location requirements, and who may access them? | Determines narrower grants, operator/support access, hosting and AI-provider constraints. | OP07/RD09; any real sensitive customer data; unsupported cases must be excluded until resolved |
| PO08 | What deadline, peak edition/concurrent-user workload, newsroom hardware/network conditions and tolerable outage/data-loss window must the pilot support? | Sets measurable capacity, supported browsers/devices, recovery and operational investment. | OP08/RD12; sizing and customer reliability commitments |
| PO09 | Who pays, what is the initial packaging hypothesis (publication/seat/usage/storage), and what access/grace period should remain when payment stops? | Changes entitlements, unit economics and support/offboarding; does not allow bypassing print correctness. | OP09/RD11; paid pilot |
| PO10 | Which wire/RSS/API/CMS/website sources and customer-owned imports are essential initially, and which contracts can the customer provide for storage, editing, AI, print and archive use? | Prioritizes connectors and determines whether full-text ingestion is allowed; licensed discovery is not unrestricted republication. | OP10/RD07; each live source and any protected-content processing |

## CAN DEFER

| ID | Question | Material consequence | Revisit trigger |
|---|---|---|---|
| PO11 | After the browser press pilot, which expansion matters first: disconnected/desktop operation, e-paper/API distribution, enterprise isolation, or richer archive discovery? | These demand different investments and should not all enter the initial roadmap by implication. | DF01/03–05; after pilot learning and a separately approved scope |

## How answers become decisions

Record the owner, answer/date, affected publication/customer scope and revised acceptance gate. Update the linked OP/RD record and master/roadmap where necessary. A press's technical profile and a rights-holder's license are evidence to obtain, not facts the owner should invent. If an answer conflicts with the locked deterministic or tenant-isolation requirements, revise the product commitment openly rather than silently weakening safety.
