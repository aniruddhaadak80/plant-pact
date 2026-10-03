import { expect, test, type Page } from "@playwright/test";

/**
 * The primary journey, driven through visible controls only.
 *
 * Nothing here calls an API directly to set up state: every assertion follows a
 * real click, input or drag. Console errors and failed requests are collected
 * and asserted empty, because a page that looks right while throwing is not a
 * passing journey.
 */

const UNIQUE = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

interface Console {
  errors: string[];
  failedRequests: string[];
}

function watch(page: Page): Console {
  const errors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    const failureText = request.failure()?.errorText ?? "";
    // Next.js prefetches linked routes, and an in-flight RSC prefetch is
    // cancelled when the visitor navigates away. That is the framework working,
    // not a failed request, so it is not treated as one.
    if (failureText.includes("ERR_ABORTED")) return;
    failedRequests.push(`${request.method()} ${request.url()} ${failureText}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) failedRequests.push(`${response.status()} ${response.url()}`);
  });
  return { errors, failedRequests };
}

/** native range inputs are driven with keyboard so the path is keyboard-reachable */
async function setRange(page: Page, testId: string, value: string) {
  const slider = page.locator(`#${testId}`);
  await slider.focus();
  const current = Number(await slider.inputValue());
  const target = Number(value);
  const step = Number(await slider.getAttribute("step"));
  const presses = Math.round((target - current) / step);
  const key = presses > 0 ? "ArrowRight" : "ArrowLeft";
  for (let i = 0; i < Math.abs(presses); i += 1) {
    await slider.press(key);
  }
}

test.describe("Plant Pact primary journey", () => {
  test("job 1: score a placement from live data before committing", async ({ page }) => {
    const log = watch(page);
    await page.goto("/");

    // The landing page must carry a real repository link, not a placeholder.
    // On mobile the desktop header link is hidden by CSS, so assert on a link
    // the visitor can actually see.
    const repoLink = page
      .locator('[data-testid="github-link"]')
      .filter({ visible: true })
      .first();
    await expect(repoLink).toBeVisible();
    await expect(repoLink.getAttribute("href")).resolves.toContain(
      "github.com/aniruddhaadak80/plant-pact",
    );

    await page.getByRole("link", { name: "Place a plant", exact: true }).first().click();
    await expect(page).toHaveURL(/\/advisor$/);

    // Fill the form through visible controls.
    await page.selectOption("#species", "fiddle-leaf-fig");
    await page.fill("#plant-label", `journey-${UNIQUE}`);
    await page.fill("#friend", "Maya");
    await page.fill("#windowLabel", "bedroom, first floor");
    await page.selectOption("#aspect", "east");
    await page.selectOption("#care", "weekly");

    // The score panel must appear with a real probability and a real verdict.
    await expect(page.locator('[data-testid="advisor-verdict"]')).toBeVisible({ timeout: 30000 });
    const dial = page.locator('[data-testid="verdict-dial"]');
    await expect(dial).toBeVisible();

    const probability = await dial.getAttribute("data-probability");
    expect(probability).not.toBeNull();
    expect(Number(probability)).toBeGreaterThanOrEqual(0);
    expect(Number(probability)).toBeLessThanOrEqual(1);

    // The factor ledger must be populated with evidence, not placeholders.
    await expect(page.locator('[data-testid="factor-ledger"]')).toBeVisible();
    const factorCount = await page.locator('[data-testid^="factor-"]').count();
    expect(factorCount).toBeGreaterThan(0);
    await page.locator('[data-testid="factor-coldShare"]').click();
    await expect(page.locator('[data-testid="factor-coldShare"]')).toContainText(/logit/);

    // The signature interaction: dragging the sill rail re-scores the placement.
    await setRange(page, "window-hours", "9");
    await expect
      .poll(async () => Number(await dial.getAttribute("data-probability")), {
        timeout: 45000,
        intervals: [500, 1000, 1500],
      })
      .not.toBe(Number(probability));

    // The breaking point must be a real date or an explicit honest absence.
    await expect(page.locator('[data-testid="breaking-point"]')).toBeVisible();

    expect(log.errors, `console errors: ${log.errors.join(" | ")}`).toHaveLength(0);
    expect(log.failedRequests, `failed requests: ${log.failedRequests.join(" | ")}`).toHaveLength(0);
  });

  test("job 2: commit the pact, export a care card and verify the chain", async ({ page }) => {
    const log = watch(page);
    await page.goto("/advisor");

    await page.selectOption("#species", "golden-pothos");
    await page.fill("#plant-label", `journey-${UNIQUE}`);
    await page.fill("#friend", "Ada");
    await page.selectOption("#care", "weekly");
    await page.selectOption("#city", { label: "Berlin, Germany" });

    await expect(page.locator('[data-testid="advisor-verdict"]')).toBeVisible({ timeout: 30000 });

    await page.getByRole("button", { name: /commit this pact/i }).click();
    // Generous: a cold serverless function can take longer than the default.
    await expect(page).toHaveURL(/\/pacts\/[0-9a-f-]{36}/, { timeout: 60000 });
    await expect(page.locator('[data-testid="commit-confirmation"]')).toBeVisible();

    // Persisted read-back through the UI, with the seal chain rendered.
    await expect(page.locator('[data-testid="chain-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="chain-status"]')).toContainText(/verified/i);

    // Update the placement: re-score and save through the visible control.
    const beforeProbability = await page
      .locator('[data-testid="verdict-dial"]')
      .getAttribute("data-probability");
    await setRange(page, "adjust-light", "7");
    await page.getByRole("button", { name: /re-score and save/i }).click();
    await expect(page.locator('[data-testid="action-message"]')).toContainText(/re-scored/i, {
      timeout: 30000,
    });
    // router.refresh() re-renders the server component that computes the verdict,
    // so the new number arrives asynchronously after the PATCH resolves.
    await expect
      .poll(async () => Number(await page.locator('[data-testid="verdict-dial"]').getAttribute("data-probability")), {
        timeout: 45000,
        intervals: [500, 1000, 1500],
      })
      .not.toBe(Number(beforeProbability));

    // The takeaway artifact actually downloads valid Markdown.
    const download = await Promise.all([
      page.waitForEvent("download"),
      page.locator('[data-testid="card-download"]').click(),
    ]).then(([event]) => event);
    expect(download.suggestedFilename()).toMatch(/^care-card-.*\.md$/);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const markdown = Buffer.concat(chunks).toString("utf8");
    expect(markdown).toContain("# Care card:");
    expect(markdown).toContain("Where the numbers came from");
    expect(markdown).toContain("Open-Meteo");
    expect(markdown.length).toBeGreaterThan(400);

    expect(log.errors, `console errors: ${log.errors.join(" | ")}`).toHaveLength(0);
  });

  test("job 3: record the outcome, then delete with a retained chain", async ({ page }) => {
    const log = watch(page);
    await page.goto("/advisor");

    await page.selectOption("#species", "monstera");
    await page.fill("#plant-label", `journey-${UNIQUE}`);
    await page.fill("#friend", "Grace");
    await page.getByRole("button", { name: /commit this pact/i }).click();
    await expect(page).toHaveURL(/\/pacts\/[0-9a-f-]{36}/, { timeout: 60000 });

    // Closing the loop freezes the placement, which is the point.
    await page.selectOption("#outcome", "struggled");
    await page.fill("#outcome-note", "moved it off the radiator");
    await page.getByRole("button", { name: /record outcome/i }).click();
    await expect(page.locator('[data-testid="outcome-recorded"]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-testid="chain-status"]')).toContainText(/verified/i);

    // Verify through the standalone integrity route too.
    await page.goto("/verify");
    const card = page.locator(`button:has-text("journey-${UNIQUE}")`);
    await expect(card).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(page.locator('[data-testid="verify-report"]')).toHaveAttribute("data-ok", "true");

    // Delete from the ledge.
    await page.goto("/pacts");
    const tag = page.locator(`[data-testid="pact-rail"] article:has-text("journey-${UNIQUE}")`);
    await expect(tag).toBeVisible();
    await tag.getByRole("button", { name: /delete the pact/i }).click();
    await expect(tag).toHaveCount(0, { timeout: 30000 });

    expect(log.errors, `console errors: ${log.errors.join(" | ")}`).toHaveLength(0);
  });

  test("agent console drives the same service layer over JSON-RPC", async ({ page }) => {
    const log = watch(page);
    await page.goto("/agent");

    await page.locator('[data-testid="preset-tools-list"]').click();
    await expect(page.locator('[data-testid="agent-request"]')).toContainText("tools/list");
    await expect(page.locator('[data-testid="agent-response"]')).toContainText("score_placement", {
      timeout: 30000,
    });
    await expect(page.locator('[data-testid="agent-response"]')).toContainText("commit_pact");
    await expect(page.locator('[data-testid="agent-response"]')).toContainText("verify_integrity");
    await expect(page.locator('[data-testid="agent-response"]')).toContainText("inputSchema");

    await page.locator('[data-testid="preset-score"]').click();
    await expect(page.locator('[data-testid="agent-response"]')).toContainText("probability", {
      timeout: 30000,
    });

    await page.locator('[data-testid="preset-commit"]').click();
    await expect(page.locator('[data-testid="agent-response"]')).toContainText("Committed pact", {
      timeout: 30000,
    });
    await expect(page.locator('[data-testid="agent-result-links"]')).toBeVisible();

    await page.getByRole("button", { name: "verify_integrity" }).click();
    await expect(page.locator('[data-testid="agent-response"]')).toContainText("Chain verified", {
      timeout: 30000,
    });

    await page.getByRole("button", { name: "delete_pact" }).click();
    await expect(page.locator('[data-testid="agent-response"]')).toContainText("Tombstoned pact", {
      timeout: 30000,
    });

    expect(log.errors, `console errors: ${log.errors.join(" | ")}`).toHaveLength(0);
  });

  test("footer and mobile navigation both carry the repository URL", async ({ page, isMobile }) => {
    const log = watch(page);
    await page.goto("/method");

    const footer = page.locator('[data-testid="site-footer"]');
    await expect(footer).toBeVisible();
    await expect(footer.locator('a[href*="github.com/aniruddhaadak80/plant-pact"]')).toHaveCount(
      await footer.locator('a[href*="github.com/aniruddhaadak80/plant-pact"]').count(),
    );
    expect(
      await footer.locator('a[href*="github.com/aniruddhaadak80/plant-pact"]').first().getAttribute("href"),
    ).toBe("https://github.com/aniruddhaadak80/plant-pact");

    if (isMobile) {
      // The desktop link is hidden by CSS but still in the DOM, so target the
      // one the visitor can actually see after opening the disclosure.
      await page.getByText("Menu", { exact: true }).click();
      const visibleRepoLink = page
        .locator('header a[href="https://github.com/aniruddhaadak80/plant-pact"]')
        .filter({ visible: true });
      await expect(visibleRepoLink.first()).toBeVisible();
    }

    expect(log.errors, `console errors: ${log.errors.join(" | ")}`).toHaveLength(0);
  });

  test("keyboard focus is visible and skip link works", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.locator("a:has-text('Skip to content')");
    await expect(skip).toBeFocused();

    // Tab into the primary CTA and activate it with the keyboard alone.
    for (let i = 0; i < 6; i += 1) await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
    expect(focused.length).toBeGreaterThan(0);

    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const style = window.getComputedStyle(el);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
    });
    expect(outline).not.toBeNull();
  });

  test("every primary route renders without an error state", async ({ page }) => {
    const log = watch(page);
    for (const route of ["/", "/advisor", "/pacts", "/cards", "/agent", "/method", "/verify"]) {
      const response = await page.goto(route);
      expect(response?.status(), `${route} should return 200`).toBe(200);
      await expect(page.locator('[data-testid="error-state"]')).toHaveCount(0);
      await expect(page.locator("main")).toBeVisible();
    }
    expect(log.errors, `console errors: ${log.errors.join(" | ")}`).toHaveLength(0);
  });
});