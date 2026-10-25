import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, phone: string) {
  await page.goto("/login");
  await page.getByPlaceholder("+15551234567").fill(phone);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: /Verify/ }).click();
  await expect(page.getByRole("button", { name: "New chat" })).toBeVisible();
}

test("sign in, send a message, react to it, and see it arrive live for the other person", async ({
  browser,
}) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  await signIn(alice, "+15550010001");
  await signIn(bob, "+15550010002");

  await alice.getByText("Bob Martinez").first().click();
  await bob.getByText("Alice Chen").first().click();

  const text = `hello from e2e ${Date.now()}`;
  const box = alice.getByPlaceholder(/message/i);
  await box.fill(text);
  await box.press("Enter");

  await expect(alice.locator("[data-message-id]", { hasText: text })).toBeVisible();
  // Delivered live over the WebSocket, without reloading Bob's page.
  await expect(bob.locator("[data-message-id]", { hasText: text })).toBeVisible();

  // Bob reacts; Alice sees the reaction appear.
  const bobMessage = bob.locator("[data-message-id]", { hasText: text });
  await bobMessage.hover();
  await bobMessage.getByRole("button", { name: "React" }).click();
  await bob.getByRole("menuitem", { name: "👍" }).click();
  await expect(
    alice.locator("[data-message-id]", { hasText: text }).getByRole("button", { name: /👍/ })
  ).toBeVisible();
});

test("a wrong code is rejected", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: /Verify/ }).click();
  await expect(page.getByRole("button", { name: "New chat" })).toHaveCount(0);
  await expect(page).toHaveURL(/login/);
});
