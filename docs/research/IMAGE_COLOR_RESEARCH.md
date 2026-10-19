# Image and colour pipeline — Phase 8

Research date: 2026-09-15. Recommendation: WRAP libvips for server derivatives and LittleCMS for ICC transforms, conditional on exact build/codec/license review. BUILD placement semantics and print-profile policies. Colour correctness remains a press-validation gate.

## Non-destructive asset lifecycle

Upload to private staging → authorize and validate size/type → quarantine/scan → immutable original with digest → extract bounded metadata → generate versioned derivatives → expose authorized previews. Never write rotation, crop, sharpening or profile conversion back into the original. Preserve provenance, credit, caption and rights associations separately from untrusted EXIF fields. Preview metadata should exclude unnecessary GPS/person information while the restricted original remains intact according to policy.

Maintain original encoded orientation plus a normalized orientation transform. All later crops/focal points reference a documented coordinate system. Browser fit/fill/rotate/reposition controls update ImagePlacement; captions/credits are editable editorial fields with provenance. Replacement creates a new asset link and invalidates affected resolution/preflight results.

Derivative identity includes original hash, decoded orientation, transform/crop, target dimensions, resampler/sharpening settings, source/destination ICC hashes, intent, black-point handling and tool versions. Never choose a screen thumbnail for press because its URL is convenient. Cache private derivatives by tenant-scoped content identity; deduplication must not reveal cross-tenant asset existence.

## Resolution and physical transforms

Effective image PPI is sampled source pixels divided by placed inches, not the EXIF DPI label. For an axis-aligned crop with 1,200 usable pixels placed across six inches, horizontal resolution is 200 PPI even if metadata says 300. Evaluate both axes and affine scaling; rotation alone does not create detail. Use transform-aware sampling for skew/nonuniform scale. Assess resolution against asset-class/press thresholds; line art may need different thresholds from photographs. Upsampling does not restore missing information.

## Colour contract

Record embedded source profile or explicit approved assumed profile. Missing profiles are ambiguous; do not silently relabel arbitrary data. Distinguish assigning a profile (interpret unchanged sample values) from converting (change values for a destination condition). Create sRGB display derivatives for ordinary browser use and separately controlled print derivatives/colour-managed PDF inputs. Conversion intent, black policy and total area coverage depend on the press-approved profile, not a global preset.

LittleCMS handles ICC transforms; it does not decide acceptable newspaper appearance, PDF/X conformance, spot naming, overprint behavior or contractual press settings. Preserve those in PrintProfile and validate through the writer/preflight path. Soft proofing is an aid whose fidelity depends on monitor calibration, browser/display pipeline and viewing conditions; the browser must not promise contract-proof colour without a validated setup.

## Candidate matrix

| Candidate | License / compatibility | Runtime / operational fit | Recommendation |
|---|---|---|---|
| libvips | LGPL-2.1-or-later; codec/plugin dependency terms vary | C/C++ engine, Python/other bindings; demand-driven processing and threading fit derivatives. Resource bounds still mandatory. WASM exists but unnecessary for initial authoritative pipeline. | WRAP on server |
| LittleCMS | MIT core; optional plugins reviewed independently | Native C ICC engine; libvips can integrate colour transforms. WASM technically plausible but not required for server conversion. | WRAP, version profiles and transform settings |
| sharp | Apache-2.0 wrapper plus libvips/codecs | Node binding, viable if worker runtime is Node. Wrapper defaults must be audited for metadata/profile retention. | RESEARCH alternative binding, not second image pipeline |
| ImageMagick | ImageMagick license plus delegate terms | Broad format support; larger delegate/security surface. Candidate for unsupported formats only after sandbox policy review. | REFERENCE/RESEARCH fallback |
| Hosted image services | Proprietary contracts | Useful delivery/thumbnail outsourcing; data locality, originals, CMYK/ICC fidelity and exit costs need proof | RESEARCH; no production-colour authority delegated by default |

Evidence: [libvips architecture/license](https://www.libvips.org/), [source/build surface](https://github.com/libvips/libvips), [LittleCMS](https://github.com/mm2/Little-CMS), [sharp colour APIs](https://sharp.pixelplumbing.com/api-colour/). libvips documentation exposes active project news including 8.18; exact chosen version and vulnerabilities remain unassessed. Available project history does not establish security for a particular codec bundle.

## Attack surface and difficult inputs

Limit compressed bytes, decoded pixels, pages/frames, recursion, CPU time, memory and temporary disk. Disable unneeded remote loaders/delegates. SVG and PDF can contain more than a raster image: sandbox and sanitize/raster-preview them, while preserving original vectors for a separately validated print import path. Do not route all uploaded PDFs through an image rasterizer and assume ad fidelity. Process untrusted ICC/fonts/images in patched, network-restricted workers.

## Validation gate

Corpus: rotated EXIF photos, missing/wrong ICC, RGB and CMYK TIFF/JPEG, alpha channels, large panoramas, tiny line art, cropped/scaled assets, malformed/decompression-bomb samples and press-supplied colour references. Verify original bytes remain unchanged; crop matches preview/PDF; PPI reflects placement; profile handling is explicit; transformations are stable under pinned versions; working memory is bounded. Have the press inspect black text, gradients, photos and total ink behavior in the exported edition and physical print. No corpus execution or colour-engine benchmark was performed here.
