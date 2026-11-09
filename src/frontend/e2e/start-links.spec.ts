import { expect, stepSection, test, text } from "./fixtures";

// The cards of Get started say where their data come from: the paper for Important Factors, the
// repository of ComFy for Log Measures for the log measures, each in a new tab.

test("the cards of Get started link to the paper and to the repository of the log measures", async ({ page }) => {
  await page.goto("/?step=data");
  const data = stepSection(page, "data");
  const paper = data.getByRole("link", { name: text("factor.start.link_paper_label") });
  await expect(paper).toHaveCount(3);
  await expect(paper.first()).toHaveAttribute("href", "https://ceur-ws.org/Vol-4236/paper14.pdf");
  await expect(paper.first()).toHaveAttribute("target", "_blank");
  const repo = data.getByRole("link", { name: text("factor.start.link_repo_label") });
  await expect(repo).toHaveCount(1);
  await expect(repo).toHaveAttribute("href", "https://github.com/Pati-nets/ComFy-for-Log-Measures");
  // A press on a link does not choose the card.
  await expect(data.getByRole("radio", { name: text("factor.start.scenario.if_inductive.title") })).toBeChecked();
});
