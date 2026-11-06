/** The page editor's photo crop, rulers and zoom, the Pages board's save marks and the release's "Download all"
 * (batch A-editor; spread into en.ts). */
export const EDITOR_BATCH_EN = {
  // ── page editor: photo crop, focal point, rulers, zoom to selection (A6) ──
  "pageEditor.photo.heading": "Photo",
  "pageEditor.photo.crop": "Crop photo",
  "pageEditor.photo.focal": "Set focal point",
  "pageEditor.photo.reset": "Reset crop",
  "pageEditor.photo.enlarge": "Enlarge",
  "pageEditor.photo.ppiSoft": "{n} ppi: below 150 ppi, it may print soft",
  "pageEditor.photo.ppiSharp": "{n} ppi: prints sharp",
  "pageEditor.photo.zoomFloor":
    "It prints at the lowest resolution allowed for it already ({ppi} ppi): it can be moved in its frame, not enlarged.",
  "pageEditor.photo.zoomSharp": "Enlarged as far as it prints sharp ({ppi} ppi).",
  "pageEditor.photo.zoomMax": "Enlarged 400 %, the most a photo is enlarged.",
  "pageEditor.photo.cropReset": "The photo of {name} changed: its crop is reset.",
  "pageEditor.photo.canvas":
    "The page, photo mode: drag the selected story's photo to move it in its frame, or move it with the arrow keys (with Shift, further); double-click it to set its focal point. Enter or Esc returns to selecting stories.",
  "pageEditor.photo.canvasFocal":
    "The page, focal point: click the subject of the photo; the frame keeps it as near its centre as it can. Enter or Esc finishes.",
  "pageEditor.photo.sayPhoto": "Photo mode: drag the photo of {name} to move it in its frame. Esc to stop.",
  "pageEditor.photo.sayFocal":
    "Click the subject of the photo: the frame keeps it as near its centre as it can. Enter or Esc to finish.",
  "pageEditor.photo.saySelect": "Selecting stories.",
  "pageEditor.adsSet": "The advertisements on this page are set as the edition has them now.",
  "pageEditor.rulers": "Rulers",
  "pageEditor.zoomSelection": "Zoom to the selected story",
  // ── Pages board and release (A9, A10) ──
  "editionRelease.check.printsOldArtworkSave": "Or update the text on the back page, then save it.",
  "editionRelease.item.downloadAll": "Download all (ZIP)",
} as const;
