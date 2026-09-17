import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./ui/tokens.css";
import "./ui/base.css";
import { Ui001Showcase } from "./demo/ui001/Ui001Showcase.tsx";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found. Verify index.html.");
}

createRoot(rootElement).render(
  <StrictMode>
    <Ui001Showcase />
  </StrictMode>
);
