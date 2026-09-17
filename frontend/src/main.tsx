import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./ui/tokens.css";
import "./ui/base.css";
import { Ui002App } from "./demo/ui002/routeTree.tsx";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found. Verify index.html.");
}

createRoot(rootElement).render(
  <StrictMode>
    <Ui002App />
  </StrictMode>
);
