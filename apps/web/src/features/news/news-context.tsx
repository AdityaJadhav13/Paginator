import { createContext, useContext, type ReactNode } from "react";
import type { NewsService } from "../../services/index.ts";

const NewsContext = createContext<NewsService | null>(null);

/** The news finder's service, for the Sources screen. */
export function NewsProvider({ news, children }: { readonly news: NewsService; readonly children: ReactNode }) {
  return <NewsContext.Provider value={news}>{children}</NewsContext.Provider>;
}

export function useNews(): NewsService {
  const news = useContext(NewsContext);
  if (!news) throw new Error("useNews() called outside NewsProvider.");
  return news;
}
