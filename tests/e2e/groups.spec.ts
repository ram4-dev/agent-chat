import { expect, test } from "@playwright/test";
import {
  signUp,
  createGroup,
  details,
  invitation,
  joinGroup,
} from "./helpers/ui";

test("a non-member cannot see a private group and an invited person joins it", async ({
  browser,
}) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const ada = await a.newPage();
  const grace = await b.newPage();
  await ada.goto("/");
  await signUp(ada, "ada@example.com", "Ada");
  await createGroup(ada, "Research");
  await details(ada);
  await expect(
    ada.getByRole("complementary", { name: "Detalles del grupo" }),
  ).toContainText("Administrás este grupo.");
  await expect(
    ada.getByRole("list", { name: "Personas del grupo" }),
  ).toContainText("Ada (vos)");
  await grace.goto("/");
  await signUp(grace, "grace@example.com", "Grace");
  await expect(
    grace.getByRole("heading", { name: "Empezá una conversación" }),
  ).toBeVisible();
  const token = await invitation(ada);
  expect(token).toHaveLength(43);
  await joinGroup(grace, token);
  await details(grace);
  await expect(
    grace.getByRole("complementary", { name: "Detalles del grupo" }),
  ).toContainText("Sos miembro de este grupo.");
  await expect(
    grace.getByRole("list", { name: "Personas del grupo" }),
  ).toContainText("Grace (vos)");
  await a.close();
  await b.close();
});

test("an unrelated person is refused the group without learning it exists", async ({
  browser,
}) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const ada = await a.newPage();
  const mallory = await b.newPage();
  await ada.goto("/");
  await signUp(ada, "ada2@example.com", "Ada");
  await createGroup(ada, "Secret");
  await mallory.goto("/");
  await signUp(mallory, "mallory@example.com", "Mallory");
  await expect(
    mallory.getByRole("heading", { name: "Empezá una conversación" }),
  ).toBeVisible();
  await expect(mallory.getByText("Secret")).toHaveCount(0);
  await a.close();
  await b.close();
});
