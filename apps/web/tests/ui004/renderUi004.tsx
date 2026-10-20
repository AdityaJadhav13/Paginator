import { BrowserRouter } from "react-router";
import { render } from "../../src/test/render.tsx";
import { AppRoutes as Ui004Routes } from "../../src/root/AppRoot.tsx";
import { createMockApplicationEnvironment, type MockApplicationEnvironment, type MockSessionPreset } from "../../src/mocks/index.ts";

export function renderUi004(path: string, preset?: MockSessionPreset, environment: MockApplicationEnvironment = createMockApplicationEnvironment()) {
  if (preset) environment.sessionController.setPreset(preset);
  window.history.pushState(null, "", path);
  return { environment, ...render(<BrowserRouter><Ui004Routes environment={environment} /></BrowserRouter>) };
}
