import { createContext, useContext, type ReactNode } from "react";
import type { LayoutService } from "../../services/index.ts";

const LayoutContext = createContext<LayoutService | null>(null);

/** Editions and layout (L2.3): the edition's layout screen, the Today card and the engine profile screen. */
export function LayoutProvider({ layout, children }: { readonly layout: LayoutService; readonly children: ReactNode }) {
  return <LayoutContext.Provider value={layout}>{children}</LayoutContext.Provider>;
}

export function useLayout(): LayoutService {
  const layout = useContext(LayoutContext);
  if (!layout) throw new Error("useLayout() called outside LayoutProvider.");
  return layout;
}
