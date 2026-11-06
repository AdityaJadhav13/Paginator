/**
 * "Send to the Desk" refused (bundle_refused, doc 11 L2-354) on a Marathi page: each story's reason in Marathi, named
 * by its headline, from the API's reason code and values; a reason the web does not word stays the API's English,
 * marked as English. On the test double; fictional data only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { formatDate } from "../../src/i18n/dates.ts";
import { renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

vi.setConfig({ testTimeout: 30_000 });

const EDITIONS = "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/editions";

afterEach(() => {
  resetBrowserState();
  vi.restoreAllMocks();
});

describe("A refused bundle in Marathi", () => {
  it("lists each story's reason in Marathi, and a reason the web does not word in English", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem(
      {
        kind: "answer",
        status: 409,
        code: "bundle_refused",
        message: "Some stories cannot be sent to the Desk as they are. Change them, then send again.",
        requestId: "req-fictional",
        details: [
          {
            field: "stories.story-demo-004",
            message: "“Fictional water cut” has a photo that was rejected or deleted: take it off the story, or give it another, then send again.",
            reason: "bundle.photo_unusable",
            params: { headline: "Fictional water cut" },
          },
          {
            field: "stories.story-demo-005",
            message: "The subheading “## #Fictional rally” in “Fictional fair” starts with #, which the Desk cannot print as a subheading: change it in the story.",
            reason: "bundle.subheading_hash",
            params: { subheading: "#Fictional rally", headline: "Fictional fair" },
          },
          { field: "stories.story-demo-006", message: "A fictional reason from a newer API.", reason: "bundle.something_new" },
        ],
      },
      ["editions.deskBundle"],
    );
    const { container } = renderAuth(EDITIONS, { preset: "sahyadri-editor", language: "mr", environment });
    const user = userEvent.setup();
    const date = formatDate("2026-10-24", "mr");
    await user.click(within(await screen.findByRole("table", { name: "Pune Daily Ledger चे अंक" })).getByRole("button", { name: date }));
    const detail = within(screen.getByRole("region", { name: date }));
    await user.click(detail.getByRole("button", { name: "Desk कडे पाठवा" }));

    expect(await detail.findByText("काही बातम्या जशा आहेत तशा Desk कडे पाठवता येत नाहीत. त्या बदला आणि पुन्हा पाठवा.")).toBeInTheDocument();
    const reasons = within(detail.getByRole("list")).getAllByRole("listitem");
    expect(reasons.map((item) => item.textContent)).toEqual([
      "“Fictional water cut” चे छायाचित्र नाकारले गेले आहे किंवा काढून टाकले आहे: ते बातमीवरून काढा, किंवा दुसरे द्या, मग पुन्हा पाठवा.",
      "“Fictional fair” मधील उपशीर्षक “## #Fictional rally” # ने सुरू होते, आणि Desk ते उपशीर्षक म्हणून छापू शकत नाही: बातमीत ते बदला.",
      "A fictional reason from a newer API.",
    ]);
    expect(detail.getByRole("list")).not.toHaveAttribute("lang");
    expect(within(reasons[0]!).getByText(/छायाचित्र/)).not.toHaveAttribute("lang");
    expect(within(reasons[2]!).getByText("A fictional reason from a newer API.")).toHaveAttribute("lang", "en");
    expect(await seriousViolations(container)).toEqual([]);
  });
});
