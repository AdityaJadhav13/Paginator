import { createContext, useContext, type ReactNode } from "react";
import type { EditorService } from "../../services/index.ts";

const EditorContext = createContext<EditorService | null>(null);

/** The page editor, hosted (L2.4). */
export function EditorProvider({ editor, children }: { readonly editor: EditorService; readonly children: ReactNode }) {
  return <EditorContext.Provider value={editor}>{children}</EditorContext.Provider>;
}

export function useEditor(): EditorService {
  const editor = useContext(EditorContext);
  if (!editor) throw new Error("useEditor() called outside EditorProvider.");
  return editor;
}
