import { BrowserRouter } from "react-router";
import { render } from "../../src/test/render.tsx";
import { Ui004Routes } from "../../src/demo/ui004/routeTree.tsx";
import { createMockApplicationEnvironment, type MockApplicationEnvironment, type MockSessionPreset } from "../../src/mocks/index.ts";

export function renderUi004(path: string, preset?: MockSessionPreset, environment: MockApplicationEnvironment = createMockApplicationEnvironment()) {
  if (preset) environment.sessionController.setPreset(preset);
  window.history.pushState(null, "", path);
  return { environment, ...render(<BrowserRouter><Ui004Routes environment={environment} /></BrowserRouter>) };
}
