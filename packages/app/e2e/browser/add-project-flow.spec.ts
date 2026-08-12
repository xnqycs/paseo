import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "../support/fixtures";
import {
  addProjectFlow,
  addProjectFlowBack,
  addProjectFlowHost,
  addProjectFlowInput,
  addProjectFlowMethod,
  chooseAddProjectMethod,
  expectAddProjectPage,
  expectNewWorkspaceForAddedProject,
  failNextDirectorySuggestionWithBusinessError,
  holdNextDirectorySuggestionsResponse,
  openAddProjectFlow,
  openAddProjectHostSelection,
  rewriteDirectorySuggestionsToLegacy,
} from "../support/helpers/add-project-flow";
import { gotoAppShell } from "../support/helpers/app";
import { installDaemonWebSocketGate } from "../support/helpers/daemon-websocket-gate";
import {
  addConnectedHostAndReload,
  addOfflineHostAndReload,
  waitForConnectedHost,
} from "../support/helpers/hosts";
import {
  type IsolatedHostDaemon,
  startIsolatedHostDaemon,
} from "../support/helpers/isolated-host-daemon";
import { expectOpenedProject } from "../support/helpers/project-picker-ui";
import { connectSeedClient } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";

const SECONDARY_HOST_ID = "add-project-flow-secondary";
const SECONDARY_HOST_LABEL = "Secondary Host";

async function expectProjectDirectory(pathname: string): Promise<void> {
  await expect.poll(async () => (await stat(pathname)).isDirectory()).toBe(true);
}

async function removeCreatedProject(
  pathname: string,
  knownProjectId: string | null,
): Promise<void> {
  const client = await connectSeedClient();
  try {
    let projectId = knownProjectId;
    if (!projectId) {
      const result = await client.addProject(pathname);
      projectId = result.project?.projectId ?? null;
    }
    if (projectId) await client.removeProject(projectId).catch(() => undefined);
  } finally {
    await client.close();
  }
}

async function expectProjectHasNoWorkspaces(projectId: string): Promise<void> {
  const client = await connectSeedClient();
  try {
    const result = await client.fetchWorkspaces({ filter: { projectId } });
    expect(result.entries).toEqual([]);
  } finally {
    await client.close();
  }
}

test.describe("Add Project command-center flow", () => {
  test.describe.configure({ timeout: 180_000 });

  test("method selection has no search field", async ({ page }) => {
    await gotoAppShell(page);

    await openAddProjectFlow(page);

    await expect(addProjectFlowMethod(page, "directory-search")).toBeVisible();
    await expect(addProjectFlowMethod(page, "directory-search")).toContainText("Open directory");
    await expect(addProjectFlowMethod(page, "directory-fuzzy-search")).toContainText(
      "Search directories",
    );
    await expect(addProjectFlowInput(page)).toHaveCount(0);
    await expect(addProjectFlow(page).getByRole("textbox")).toHaveCount(0);
    await expect(page.getByTestId("add-project-flow-page-host")).toHaveCount(0);
  });

  test("the back arrow, search input, and result glyph share one left edge", async ({ page }) => {
    await gotoAppShell(page);
    await openAddProjectFlow(page);

    await page.keyboard.press("Enter");
    await expectAddProjectPage(page, "directory-search");
    await addProjectFlowInput(page).fill("/tmp");

    const backGlyph = addProjectFlowBack(page).locator("svg");
    const resultGlyph = addProjectFlow(page)
      .locator('[data-testid^="add-project-flow-path-"]')
      .first()
      .locator("svg");
    await expect(resultGlyph).toBeVisible();

    const [backBox, inputBox, resultBox, titleBox, resultsBox, footerBox] = await Promise.all([
      backGlyph.boundingBox(),
      addProjectFlowInput(page).boundingBox(),
      resultGlyph.boundingBox(),
      page.getByTestId("add-project-flow-title").boundingBox(),
      page.getByTestId("add-project-flow-results").boundingBox(),
      page.getByTestId("add-project-flow-footer").boundingBox(),
    ]);
    expect(backBox).not.toBeNull();
    expect(inputBox).not.toBeNull();
    expect(resultBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(resultsBox).not.toBeNull();
    expect(footerBox).not.toBeNull();
    if (!backBox || !inputBox || !resultBox || !titleBox || !resultsBox || !footerBox) return;

    expect(Math.abs(backBox.x - inputBox.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(resultBox.x - inputBox.x)).toBeLessThanOrEqual(2);
    expect(titleBox.height).toBeLessThanOrEqual(24);
    expect(resultsBox.y + resultsBox.height).toBeLessThanOrEqual(footerBox.y + 1);
  });

  test("an offline extra host neither appears nor forces host selection", async ({ page }) => {
    await gotoAppShell(page);
    await addOfflineHostAndReload(page, {
      serverId: "add-project-flow-offline",
      label: "Offline Host",
    });

    await openAddProjectFlow(page);

    await expect(addProjectFlowHost(page, "add-project-flow-offline")).toHaveCount(0);
    await expect(addProjectFlowMethod(page, "directory-search")).toBeVisible();
  });

  test.describe("with two connected hosts", () => {
    let secondaryHost: IsolatedHostDaemon;

    test.beforeAll(async () => {
      secondaryHost = await startIsolatedHostDaemon(SECONDARY_HOST_ID);
    });

    test.afterAll(async () => {
      await secondaryHost?.close();
    });

    test("keyboard selection chooses the second host", async ({ page }) => {
      await gotoAppShell(page);
      await addConnectedHostAndReload(page, {
        serverId: secondaryHost.serverId,
        label: SECONDARY_HOST_LABEL,
        port: secondaryHost.port,
      });
      await waitForConnectedHost(page, {
        serverId: SECONDARY_HOST_ID,
        endpoint: `localhost:${secondaryHost.port}`,
      });
      await openAddProjectHostSelection(page);

      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");

      await expectAddProjectPage(page, "method");
      await expect(addProjectFlow(page)).toContainText(SECONDARY_HOST_LABEL);
    });

    test("Escape and Back restore searchable page input before closing at the root", async ({
      page,
    }) => {
      await gotoAppShell(page);
      await addConnectedHostAndReload(page, {
        serverId: secondaryHost.serverId,
        label: SECONDARY_HOST_LABEL,
        port: secondaryHost.port,
      });
      await waitForConnectedHost(page, {
        serverId: SECONDARY_HOST_ID,
        endpoint: `localhost:${secondaryHost.port}`,
      });
      await openAddProjectHostSelection(page);

      await addProjectFlowInput(page).fill("o");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expectAddProjectPage(page, "method");

      await chooseAddProjectMethod(page, "new-directory");
      await expectAddProjectPage(page, "new-directory-parent");
      await page.keyboard.press("Escape");

      await expectAddProjectPage(page, "method");
      await expect(addProjectFlowInput(page)).toHaveCount(0);
      await chooseAddProjectMethod(page, "new-directory");
      await expectAddProjectPage(page, "new-directory-parent");
      await addProjectFlowBack(page).click();

      await expectAddProjectPage(page, "method");
      await addProjectFlowBack(page).click();
      await expectAddProjectPage(page, "host");
      await expect(addProjectFlowInput(page)).toHaveValue("o");
      await page.keyboard.press("Enter");
      await expectAddProjectPage(page, "method");
      await expect(addProjectFlow(page)).toContainText(SECONDARY_HOST_LABEL);

      await page.keyboard.press("Escape");
      await expectAddProjectPage(page, "host");
      await page.keyboard.press("Escape");
      await expect(addProjectFlow(page)).not.toBeVisible();
    });

    test("New directory creates a Project on the selected remote host", async ({ page }) => {
      const parentDirectory = await mkdtemp(path.join(tmpdir(), "paseo-e2e-remote-project-"));
      const directoryName = `remote-${randomUUID().slice(0, 8)}`;
      const directoryPath = path.join(parentDirectory, directoryName);

      try {
        await gotoAppShell(page);
        await addConnectedHostAndReload(page, {
          serverId: secondaryHost.serverId,
          label: SECONDARY_HOST_LABEL,
          port: secondaryHost.port,
        });
        await waitForConnectedHost(page, {
          serverId: SECONDARY_HOST_ID,
          endpoint: `localhost:${secondaryHost.port}`,
        });
        await openAddProjectHostSelection(page);
        await addProjectFlowHost(page, SECONDARY_HOST_ID).click();
        await expectAddProjectPage(page, "method");

        await expect(addProjectFlowMethod(page, "new-directory")).toContainText(
          `Create an empty directory on ${SECONDARY_HOST_LABEL}`,
        );
        await chooseAddProjectMethod(page, "new-directory");
        await addProjectFlowInput(page).fill(parentDirectory);
        await page.keyboard.press("Enter");
        await expectAddProjectPage(page, "new-directory-name");
        await page.keyboard.type(directoryName);
        await page.keyboard.press("Enter");

        const projectId = await expectOpenedProject(page, directoryName);
        await expectNewWorkspaceForAddedProject(page, {
          serverId: SECONDARY_HOST_ID,
          projectId,
          projectName: directoryName,
          projectPath: directoryPath,
        });
        await expect(page.getByTestId("host-picker-trigger")).toContainText(SECONDARY_HOST_LABEL);
        await expectProjectDirectory(directoryPath);
      } finally {
        await rm(parentDirectory, { recursive: true, force: true });
      }
    });
  });

  test("keyboard exact directory path adds the selected Project", async ({
    page,
    projectPickerFixture,
  }) => {
    await gotoAppShell(page);
    await openAddProjectFlow(page);

    await page.keyboard.press("Enter");
    await expectAddProjectPage(page, "directory-search");
    await addProjectFlowInput(page).fill(projectPickerFixture.projectPath);
    await expect(
      page.getByTestId(
        `add-project-flow-path-${encodeURIComponent(projectPickerFixture.projectPath)}`,
      ),
    ).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Enter");

    const projectId = await expectOpenedProject(page, projectPickerFixture.projectName);
    projectPickerFixture.rememberProjectId(projectId);
    await expectNewWorkspaceForAddedProject(page, {
      serverId: getServerId(),
      projectId,
      projectName: projectPickerFixture.projectName,
      projectPath: projectPickerFixture.projectPath,
    });
    await expectProjectHasNoWorkspaces(projectId);
  });

  test("fuzzy directory search is a separate method", async ({ page, projectPickerFixture }) => {
    await gotoAppShell(page);
    await openAddProjectFlow(page);
    await chooseAddProjectMethod(page, "directory-fuzzy-search");
    await page.keyboard.type(projectPickerFixture.fuzzyQuery);
    await expect(addProjectFlow(page)).toContainText(projectPickerFixture.projectName, {
      timeout: 30_000,
    });
    await page.keyboard.press("Enter");

    const projectId = await expectOpenedProject(page, projectPickerFixture.projectName);
    projectPickerFixture.rememberProjectId(projectId);
    await expectNewWorkspaceForAddedProject(page, {
      serverId: getServerId(),
      projectId,
      projectName: projectPickerFixture.projectName,
      projectPath: projectPickerFixture.projectPath,
    });
    await expectProjectHasNoWorkspaces(projectId);
  });

  test("path input lists only the selected directory and its direct children", async ({
    page,
    projectPickerFixture,
  }) => {
    const gate = await installDaemonWebSocketGate(page);
    const parentDirectory = path.dirname(projectPickerFixture.projectPath);
    const matchedDirectory = path.join(parentDirectory, "docker_data");
    const partialPath = path.join(parentDirectory, "docker");
    const childDirectory = path.join(matchedDirectory, "direct-child");
    const nestedDirectory = path.join(childDirectory, "nested");
    await mkdir(nestedDirectory, { recursive: true });
    await gotoAppShell(page);
    await openAddProjectFlow(page);
    await chooseAddProjectMethod(page, "directory-search");

    await addProjectFlowInput(page).fill(partialPath);
    await expect(
      page.getByTestId(`add-project-flow-path-${encodeURIComponent(matchedDirectory)}`),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByTestId(`add-project-flow-path-${encodeURIComponent(partialPath)}`),
    ).toHaveCount(0);
    await expect(
      page.getByTestId(`add-project-flow-path-${encodeURIComponent(childDirectory)}`),
    ).toHaveCount(0);

    await addProjectFlowInput(page).fill(matchedDirectory);
    await expect(
      page.getByTestId(`add-project-flow-path-${encodeURIComponent(childDirectory)}`),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByTestId(`add-project-flow-path-${encodeURIComponent(nestedDirectory)}`),
    ).toHaveCount(0);
    expect(gate.getClientRequestCount("directory_suggestions_request")).toBe(0);

    await rm(matchedDirectory, { recursive: true, force: true });
  });

  test("legacy directory suggestions without entries still render and open", async ({
    page,
    projectPickerFixture,
  }) => {
    await rewriteDirectorySuggestionsToLegacy(page);
    await gotoAppShell(page);
    await openAddProjectFlow(page);
    await chooseAddProjectMethod(page, "directory-fuzzy-search");

    await addProjectFlowInput(page).fill(projectPickerFixture.fuzzyQuery);
    const pathRow = page.getByTestId(
      `add-project-flow-path-${encodeURIComponent(projectPickerFixture.projectPath)}`,
    );
    await expect(pathRow).toBeVisible({ timeout: 30_000 });
    await pathRow.click();

    const projectId = await expectOpenedProject(page, projectPickerFixture.projectName);
    projectPickerFixture.rememberProjectId(projectId);
    await expectNewWorkspaceForAddedProject(page, {
      serverId: getServerId(),
      projectId,
      projectName: projectPickerFixture.projectName,
      projectPath: projectPickerFixture.projectPath,
    });
  });

  // Protocol-boundary injection: the first directory_suggestions response is a
  // hand-built business error at the WebSocket gate. Recovery must forward the
  // next request to the real daemon (page.unrouteAll does not clear WS routes).
  test("one-shot protocol-boundary directory error stays visible and recovers after a new query", async ({
    page,
    projectPickerFixture,
  }) => {
    const searchError = "Directory search failed: permission denied for test root";
    const gate = await failNextDirectorySuggestionWithBusinessError(page, searchError);
    await gotoAppShell(page);
    await openAddProjectFlow(page);
    await chooseAddProjectMethod(page, "directory-fuzzy-search");

    await addProjectFlowInput(page).fill("will-fail-once");
    const queryError = page.getByTestId("add-project-flow-query-error");
    await expect(queryError).toBeVisible({ timeout: 30_000 });
    await expect(queryError).toHaveText(searchError);
    await expectAddProjectPage(page, "directory-fuzzy-search");
    await expect(addProjectFlowInput(page)).toHaveValue("will-fail-once");
    await expect(addProjectFlowInput(page)).toBeEditable();
    expect(gate.injectedCount()).toBe(1);
    expect(gate.forwardedCount()).toBe(0);

    // One-shot gate: the second query is forwarded to the real daemon automatically.
    await addProjectFlowInput(page).fill(projectPickerFixture.fuzzyQuery);
    await expect(queryError).toHaveCount(0, { timeout: 30_000 });
    await expect(addProjectFlow(page)).toContainText(projectPickerFixture.projectName, {
      timeout: 30_000,
    });
    expect(gate.injectedCount()).toBe(1);
    expect(gate.forwardedCount()).toBeGreaterThanOrEqual(1);
  });

  test("does not submit twice while add project is pending", async ({ page }) => {
    const parentDirectory = await mkdtemp(path.join(tmpdir(), "paseo-e2e-add-pending-"));
    const directoryName = `pending-${randomUUID().slice(0, 8)}`;
    const directoryPath = path.join(parentDirectory, directoryName);
    let projectId: string | null = null;
    const gate = await installDaemonWebSocketGate(page);

    try {
      await mkdir(directoryPath, { recursive: true });
      await gotoAppShell(page);
      await openAddProjectFlow(page);
      await chooseAddProjectMethod(page, "directory-search");

      gate.holdNextClientRequest("project.add.request");
      await addProjectFlowInput(page).fill(directoryPath);
      await page.keyboard.press("Enter");
      await gate.waitForHeldClientRequest();
      await expect(page.getByTestId("add-project-flow-progress")).toBeVisible({ timeout: 30_000 });
      await expect(addProjectFlowInput(page)).not.toBeEditable();

      // Second submit must be ignored while the first add is still in flight.
      await page.keyboard.press("Enter");
      expect(gate.getClientRequestCount("project.add.request")).toBe(1);

      gate.releaseHeldClientRequest();
      projectId = await expectOpenedProject(page, directoryName);
      await expectNewWorkspaceForAddedProject(page, {
        serverId: getServerId(),
        projectId,
        projectName: directoryName,
        projectPath: directoryPath,
      });
      expect(gate.getClientRequestCount("project.add.request")).toBe(1);
    } finally {
      await removeCreatedProject(directoryPath, projectId).catch(() => undefined);
      await rm(parentDirectory, { recursive: true, force: true });
    }
  });

  test("shows loading and then an empty result without collapsing the layout", async ({ page }) => {
    const emptyQuery = `zzz-no-match-${randomUUID()}`;
    const hold = await holdNextDirectorySuggestionsResponse(page);

    await gotoAppShell(page);
    await openAddProjectFlow(page);
    await chooseAddProjectMethod(page, "directory-fuzzy-search");

    await addProjectFlowInput(page).fill(emptyQuery);
    await hold.waitForHeld();
    const loading = page.getByTestId("add-project-flow-loading");
    await expect(loading).toBeVisible({ timeout: 30_000 });

    const [resultsWhileLoading, footerWhileLoading] = await Promise.all([
      page.getByTestId("add-project-flow-results").boundingBox(),
      page.getByTestId("add-project-flow-footer").boundingBox(),
    ]);
    expect(resultsWhileLoading).not.toBeNull();
    expect(footerWhileLoading).not.toBeNull();
    if (!resultsWhileLoading || !footerWhileLoading) return;
    expect(resultsWhileLoading.y + resultsWhileLoading.height).toBeLessThanOrEqual(
      footerWhileLoading.y + 1,
    );

    hold.release();
    await expect(loading).toHaveCount(0, { timeout: 30_000 });
    const empty = page.getByTestId("add-project-flow-empty");
    await expect(empty).toBeVisible({ timeout: 30_000 });
    await expect(empty).toHaveText("No matching options");

    const [resultsWhenEmpty, footerWhenEmpty] = await Promise.all([
      page.getByTestId("add-project-flow-results").boundingBox(),
      page.getByTestId("add-project-flow-footer").boundingBox(),
    ]);
    expect(resultsWhenEmpty).not.toBeNull();
    expect(footerWhenEmpty).not.toBeNull();
    if (!resultsWhenEmpty || !footerWhenEmpty) return;
    expect(resultsWhenEmpty.y + resultsWhenEmpty.height).toBeLessThanOrEqual(footerWhenEmpty.y + 1);
    // Footer stays anchored; loading → empty must not collapse the results rail away from it.
    expect(Math.abs(footerWhenEmpty.y - footerWhileLoading.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(resultsWhenEmpty.y - resultsWhileLoading.y)).toBeLessThanOrEqual(2);
  });

  test("add project failure keeps the search page and allows retry", async ({ page }) => {
    const missingPath = `/tmp/paseo-add-project-missing-${randomUUID()}`;
    await gotoAppShell(page);
    await openAddProjectFlow(page);
    await chooseAddProjectMethod(page, "directory-search");

    await addProjectFlowInput(page).fill(missingPath);
    await page.keyboard.press("Enter");

    const error = page.getByTestId("add-project-flow-error");
    await expect(error).toBeVisible({ timeout: 30_000 });
    await expect(error).toContainText(/directory not found|unable to add project/i);
    await expectAddProjectPage(page, "directory-search");
    await expect(addProjectFlowInput(page)).toHaveValue(missingPath);
    await expect(addProjectFlowInput(page)).toBeEditable();

    // Correct the path to a real directory and submit again.
    const parentDirectory = await mkdtemp(path.join(tmpdir(), "paseo-e2e-add-retry-"));
    const directoryName = `retry-${randomUUID().slice(0, 8)}`;
    const directoryPath = path.join(parentDirectory, directoryName);
    let projectId: string | null = null;
    try {
      await mkdir(directoryPath, { recursive: true });
      await addProjectFlowInput(page).fill(directoryPath);
      await page.keyboard.press("Enter");

      projectId = await expectOpenedProject(page, directoryName);
      await expectNewWorkspaceForAddedProject(page, {
        serverId: getServerId(),
        projectId,
        projectName: directoryName,
        projectPath: directoryPath,
      });
    } finally {
      await removeCreatedProject(directoryPath, projectId).catch(() => undefined);
      await rm(parentDirectory, { recursive: true, force: true });
    }
  });

  test("the current daemon advertises Clone from GitHub and New directory", async ({ page }) => {
    await gotoAppShell(page);
    await openAddProjectFlow(page);

    await expect(addProjectFlowMethod(page, "github")).toContainText("Clone from GitHub");
    await expect(addProjectFlowMethod(page, "new-directory")).toContainText("New directory");
  });

  test("a complete repository URL remains selectable without a GitHub search result", async ({
    page,
  }) => {
    await gotoAppShell(page);
    await openAddProjectFlow(page);
    await chooseAddProjectMethod(page, "github");

    const remote = "https://github.invalid/acme/manual.git";
    await addProjectFlowInput(page).fill(remote);
    await expect(addProjectFlow(page).getByText("manual", { exact: true })).toBeVisible();
    await page.keyboard.press("Enter");

    await expectAddProjectPage(page, "github-location");
    const title = addProjectFlow(page).getByTestId("add-project-flow-title");
    await expect(title.getByText("Choose destination", { exact: true })).toBeVisible();
    await expect(title.getByText("localhost", { exact: true })).toBeVisible();
    await expect(title).not.toContainText("Where should Paseo create");
    await addProjectFlowBack(page).click();
    await expect(addProjectFlowInput(page)).toHaveValue(remote);
  });

  test("New directory validates the name, restores parent and name state, then creates a Project", async ({
    page,
  }) => {
    const parentDirectory = await mkdtemp(path.join(tmpdir(), "paseo-e2e-new-project-"));
    const directoryName = `created-${randomUUID().slice(0, 8)}`;
    const directoryPath = path.join(parentDirectory, directoryName);
    let projectId: string | null = null;

    try {
      await gotoAppShell(page);
      await openAddProjectFlow(page);
      await chooseAddProjectMethod(page, "new-directory");

      await page.keyboard.type(parentDirectory);
      await page.keyboard.press("Enter");
      await expectAddProjectPage(page, "new-directory-name");
      await page.keyboard.type("../invalid");
      await page.keyboard.press("Enter");

      const error = page.getByTestId("add-project-flow-error");
      await expect(error).toBeVisible();
      await expect(error).toContainText(/name|separator|directory/i);
      await expectAddProjectPage(page, "new-directory-name");

      await addProjectFlowInput(page).fill(directoryName);
      await addProjectFlowBack(page).click();
      await expectAddProjectPage(page, "new-directory-parent");
      await expect(addProjectFlowInput(page)).toHaveValue(parentDirectory);
      await page.keyboard.press("Enter");
      await expectAddProjectPage(page, "new-directory-name");
      await expect(addProjectFlowInput(page)).toHaveValue(directoryName);
      await page.keyboard.press("Enter");

      projectId = await expectOpenedProject(page, directoryName);
      await expectNewWorkspaceForAddedProject(page, {
        serverId: getServerId(),
        projectId,
        projectName: directoryName,
        projectPath: directoryPath,
      });
      await expectProjectHasNoWorkspaces(projectId);
      await expectProjectDirectory(directoryPath);
    } finally {
      await removeCreatedProject(directoryPath, projectId).catch(() => undefined);
      await rm(parentDirectory, { recursive: true, force: true });
    }
  });

  test("keeps the query and shows a recoverable error when the selected host disconnects", async ({
    page,
  }) => {
    const disconnectHostId = "add-project-flow-disconnect";
    const disconnectHostLabel = "Disconnect Host";
    // Home-scoped directory search roots at $HOME for every daemon on this machine,
    // including isolated secondary hosts — fixtures under /tmp are outside that root.
    const searchRoot = await mkdtemp(path.join(homedir(), "paseo-e2e-disconnect-search-"));
    const searchableName = `disc-${randomUUID().slice(0, 8)}`;
    const searchablePath = path.join(searchRoot, searchableName);
    const recoveryName = `recovered-${randomUUID().slice(0, 8)}`;
    const recoveryPath = path.join(searchRoot, recoveryName);
    let secondary: IsolatedHostDaemon | null = null;

    try {
      await mkdir(searchablePath, { recursive: true });
      secondary = await startIsolatedHostDaemon(disconnectHostId);
      const secondaryGate = await installDaemonWebSocketGate(page, { port: secondary.port });

      await gotoAppShell(page);
      await addConnectedHostAndReload(page, {
        serverId: secondary.serverId,
        label: disconnectHostLabel,
        port: secondary.port,
      });
      await waitForConnectedHost(page, {
        serverId: disconnectHostId,
        endpoint: `localhost:${secondary.port}`,
      });

      await openAddProjectHostSelection(page);
      await addProjectFlowHost(page, disconnectHostId).click();
      await expectAddProjectPage(page, "method");
      await chooseAddProjectMethod(page, "directory-fuzzy-search");

      await addProjectFlowInput(page).fill(searchableName);
      await expect(addProjectFlow(page)).toContainText(searchableName, { timeout: 30_000 });

      // Stop only the selected isolated daemon (same port/home). Never touch port 6767.
      await secondary.stop();
      const serverInfoCountBeforeRestart = secondaryGate.getServerInfoCount(disconnectHostId);
      const bootstrapCountBeforeRestart =
        secondaryGate.getClientRequestCount("fetch_agents_request");

      // Force a fresh directory query against the now-offline host.
      const offlineQuery = `${searchableName}-offline`;
      await addProjectFlowInput(page).fill(offlineQuery);

      const queryError = page.getByTestId("add-project-flow-query-error");
      await expect(queryError).toBeVisible({ timeout: 30_000 });
      await expectAddProjectPage(page, "directory-fuzzy-search");
      await expect(addProjectFlowInput(page)).toHaveValue(offlineQuery);
      await expect(addProjectFlowInput(page)).toBeEditable();

      // Restart the same isolated daemon on the same port; host registry stays valid.
      // Stay on the fuzzy-search page — recovery is a new query after reconnect.
      await secondary.restart();
      await secondaryGate.waitForServerInfo(disconnectHostId, serverInfoCountBeforeRestart + 1);
      await secondaryGate.waitForClientRequest(
        "fetch_agents_request",
        bootstrapCountBeforeRestart + 1,
      );

      // This directory and query did not exist before restart, so neither the
      // daemon nor React Query can satisfy recovery from pre-disconnect state.
      await mkdir(recoveryPath, { recursive: true });
      await addProjectFlowInput(page).fill(recoveryName);
      const resultRow = page.getByTestId(
        `add-project-flow-path-${encodeURIComponent(recoveryPath)}`,
      );
      await expect(resultRow).toBeVisible({ timeout: 30_000 });
      expect(secondaryGate.getDirectorySuggestionsRequestCount(recoveryName)).toBe(1);
      await expect(queryError).toHaveCount(0);
      await expectAddProjectPage(page, "directory-fuzzy-search");
      await expect(addProjectFlowInput(page)).toHaveValue(recoveryName);
      await expect(addProjectFlowInput(page)).toBeEditable();
    } finally {
      await secondary?.close().catch(() => undefined);
      await rm(searchRoot, { recursive: true, force: true });
    }
  });
});
