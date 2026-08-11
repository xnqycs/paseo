import { expect, type Locator, type Page, type WebSocketRoute } from "@playwright/test";
import { daemonWsRoutePattern } from "./daemon-port";

export type AddProjectFlowPage =
  | "host"
  | "method"
  | "directory-search"
  | "github-search"
  | "github-location"
  | "new-directory-parent"
  | "new-directory-name";

export type AddProjectMethod = "directory-search" | "browse" | "github" | "new-directory";

const METHOD_DESTINATIONS: Record<Exclude<AddProjectMethod, "browse">, AddProjectFlowPage> = {
  "directory-search": "directory-search",
  github: "github-search",
  "new-directory": "new-directory-parent",
};

export function addProjectFlow(page: Page): Locator {
  return page.getByTestId("add-project-flow");
}

export function addProjectFlowInput(page: Page): Locator {
  return page.getByTestId("add-project-flow-input");
}

export function addProjectFlowBack(page: Page): Locator {
  return page.getByTestId("add-project-flow-back");
}

export function addProjectFlowHost(page: Page, serverId: string): Locator {
  return page.getByTestId(`add-project-flow-host-${serverId}`);
}

export function addProjectFlowMethod(page: Page, method: AddProjectMethod): Locator {
  return page.getByTestId(`add-project-flow-method-${method}`);
}

export async function expectAddProjectPage(page: Page, kind: AddProjectFlowPage): Promise<Locator> {
  const currentPage = page.getByTestId(`add-project-flow-page-${kind}`);
  await expect(currentPage).toBeVisible({ timeout: 30_000 });
  return currentPage;
}

async function openAddProjectFlowSurface(
  page: Page,
  expectedPage: "host" | "method",
): Promise<void> {
  await page.getByTestId("sidebar-add-project").click();
  await expect(addProjectFlow(page)).toBeVisible({ timeout: 30_000 });
  await expectAddProjectPage(page, expectedPage);
}

export async function openAddProjectFlow(page: Page): Promise<void> {
  await openAddProjectFlowSurface(page, "method");
}

export async function openAddProjectHostSelection(page: Page): Promise<void> {
  await openAddProjectFlowSurface(page, "host");
  await expect(addProjectFlowInput(page)).toBeFocused();
}

export async function chooseAddProjectMethod(page: Page, method: AddProjectMethod): Promise<void> {
  const option = addProjectFlowMethod(page, method);
  await expect(option).toBeVisible();
  await option.click();
  if (method !== "browse") {
    await expectAddProjectPage(page, METHOD_DESTINATIONS[method]);
  }
}

export async function expectNewWorkspaceForAddedProject(
  page: Page,
  input: {
    serverId: string;
    projectId: string;
    projectName: string;
    projectPath: string;
  },
): Promise<void> {
  await expect(page).toHaveURL(/\/new\?.*projectId=/u, { timeout: 30_000 });
  const url = new URL(page.url());
  expect(url.pathname).toBe("/new");
  expect(url.searchParams.get("serverId")).toBe(input.serverId);
  expect(url.searchParams.get("projectId")).toBe(input.projectId);
  expect(url.searchParams.get("dir")).toBe(input.projectPath);
  await expect(page.getByRole("button", { name: "Workspace project" })).toContainText(
    input.projectName,
    { timeout: 30_000 },
  );
}

type WebSocketMessage = string | Buffer;

function parseSessionMessage(message: WebSocketMessage): Record<string, unknown> | null {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    const envelope = JSON.parse(raw) as { type?: unknown; message?: unknown };
    return envelope.type === "session" && envelope.message && typeof envelope.message === "object"
      ? (envelope.message as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Rewrites live directory_suggestions_response payloads to the legacy wire shape
 * (directories only, no entries) so the app/client normalization path is exercised
 * against a real daemon result order — not a hand-built mock list.
 */
export async function rewriteDirectorySuggestionsToLegacy(page: Page): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      const sessionMessage = parseSessionMessage(message);
      if (sessionMessage?.type !== "directory_suggestions_response") {
        ws.send(message);
        return;
      }
      const payload = sessionMessage.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        ws.send(message);
        return;
      }
      const { entries: _entries, ...legacyPayload } = payload as Record<string, unknown>;
      ws.send(
        JSON.stringify({
          type: "session",
          message: {
            type: "directory_suggestions_response",
            payload: legacyPayload,
          },
        }),
      );
    });
  });
}

export interface DirectorySuggestionBusinessErrorGate {
  /** How many directory_suggestions_request messages were answered with the injected error. */
  injectedCount(): number;
  /** How many directory_suggestions_request messages were forwarded to the real daemon. */
  forwardedCount(): number;
}

/**
 * One-shot protocol-boundary error injection for directory suggestions.
 *
 * Intercepts only the first `directory_suggestions_request` and answers it with a
 * hand-built business-error response (not a transport `rpc_error`). Every later
 * request is forwarded to the real daemon, including after WebSocket reconnects —
 * the failure budget lives outside the route handler so a new socket cannot fail again.
 *
 * This proves browser + WebSocket protocol + app error UI recovery. It does not
 * claim coverage of a real server-session exception path inside the search engine.
 */
export async function failNextDirectorySuggestionWithBusinessError(
  page: Page,
  errorMessage: string,
): Promise<DirectorySuggestionBusinessErrorGate> {
  // Outer-scoped gate: survives Playwright re-invoking the handler on reconnect.
  let remainingInjections = 1;
  let injected = 0;
  let forwarded = 0;

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const sessionMessage = parseSessionMessage(message);
      if (sessionMessage?.type === "directory_suggestions_request") {
        if (remainingInjections > 0) {
          remainingInjections -= 1;
          injected += 1;
          const requestId = sessionMessage.requestId;
          if (typeof requestId === "string") {
            ws.send(
              JSON.stringify({
                type: "session",
                message: {
                  type: "directory_suggestions_response",
                  payload: {
                    directories: [],
                    entries: [],
                    error: errorMessage,
                    requestId,
                  },
                },
              }),
            );
          }
          return;
        }
        forwarded += 1;
      }
      server.send(message);
    });
    server.onMessage((message) => ws.send(message));
  });

  return {
    injectedCount: () => injected,
    forwardedCount: () => forwarded,
  };
}

export interface DirectorySuggestionsResponseHold {
  waitForHeld(): Promise<void>;
  release(): void;
}

/**
 * One-shot hold of the next directory_suggestions_response from the real daemon.
 * The request is forwarded; only the response is paused so loading UI is observable
 * without random sleeps.
 */
export async function holdNextDirectorySuggestionsResponse(
  page: Page,
): Promise<DirectorySuggestionsResponseHold> {
  let held: { browser: WebSocketRoute; message: WebSocketMessage } | null = null;
  let resolveHeld: (() => void) | null = null;
  let released = false;

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      const sessionMessage = parseSessionMessage(message);
      if (sessionMessage?.type === "directory_suggestions_response" && !released && !held) {
        held = { browser: ws, message };
        resolveHeld?.();
        resolveHeld = null;
        return;
      }
      ws.send(message);
    });
  });

  return {
    waitForHeld(): Promise<void> {
      if (held) return Promise.resolve();
      return new Promise<void>((resolve) => {
        resolveHeld = resolve;
      });
    },
    release(): void {
      released = true;
      if (!held) return;
      held.browser.send(held.message);
      held = null;
    },
  };
}
