import { BrowserRouter } from "react-router";
import type { UserEvent } from "@testing-library/user-event";
import { render, screen } from "../../src/test/render.tsx";
import { AppRoutes as Ui004Routes } from "../../src/root/AppRoot.tsx";
import { createMockApplicationEnvironment, type MockApplicationEnvironment, type MockSessionPreset } from "../../src/mocks/index.ts";

export function renderUi004(path: string, preset?: MockSessionPreset, environment: MockApplicationEnvironment = createMockApplicationEnvironment()) {
  if (preset) environment.sessionController.setPreset(preset);
  window.history.pushState(null, "", path);
  return { environment, ...render(<BrowserRouter><Ui004Routes environment={environment} /></BrowserRouter>) };
}

/** Signs in through the real sign-in form, as a person would. */
export async function signInWithForm(user: UserEvent, credentials: { readonly email: string; readonly password: string }) {
  await user.type(await screen.findByLabelText("Email address"), credentials.email);
  await user.type(screen.getByLabelText("Password"), credentials.password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}
