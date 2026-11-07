import { createContext, useContext, type ReactNode } from "react";
import type { AdsService } from "../../services/index.ts";

const AdsContext = createContext<AdsService | null>(null);

/** The ads desk and the edition plan (L2.6): the Ads desk screen, the edition's Plan and Ads tabs. */
export function AdsProvider({ ads, children }: { readonly ads: AdsService; readonly children: ReactNode }) {
  return <AdsContext.Provider value={ads}>{children}</AdsContext.Provider>;
}

export function useAds(): AdsService {
  const ads = useContext(AdsContext);
  if (!ads) throw new Error("useAds() called outside AdsProvider.");
  return ads;
}
