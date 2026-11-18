import {
  BrowserWindow,
  WebContentsView,
  Menu,
  session,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import { createHash } from "node:crypto";
import path from "node:path";
import { db, levelKeys } from "@main/level";
import type { GameRepack, UserPreferences } from "@types";
import type {
  SourceBrowserCommand,
  SourceBrowserRequest,
  SourceBrowserState,
  SourceWebsiteProfile,
} from "../../types/source-browser.types";
import {
  buildSourceSelection,
  isSourceBrowsingEnabled,
  supportedSourceLink,
  validateWebsiteProfile,
  websiteUrl,
  sourceWebsiteUserAgent,
  sourceWebsiteHttpError,
  sourceNavigationDecision,
  sourceGamePageKind,
  sourceSearchQuery,
  sourceBrowserRequestKey,
} from "../../shared/source-browser-policy";
import { WindowManager } from "./window-manager";
import { assertMultipartHosterDownloadsEnabled } from "./download/multipart-hoster-feature";

const profilesKey = "sourceWebsiteProfiles";
const browsers = new Map<
  number,
  {
    window: BrowserWindow;
    owner: number;
    sourceId: string;
    requestKey: string;
    close(): void;
  }
>();
let profileGeneration = 0;
type Profiles = Record<string, SourceWebsiteProfile>;
const partition = (id: string) =>
  `persist:source-browser-${createHash("sha256").update(id).digest("hex").slice(0, 24)}`;

// Electron permits one request listener per Session. Route by WebContents so
// desktop and Big Picture windows sharing a source cannot replace each other.
const navigationGates = new WeakMap<
  Electron.Session,
  Map<number, (url: string) => boolean>
>();
function registerNavigationGate(
  siteSession: Electron.Session,
  id: number,
  allow: (url: string) => boolean
) {
  let gates = navigationGates.get(siteSession);
  if (!gates) {
    gates = new Map();
    navigationGates.set(siteSession, gates);
    const routes = gates;
    siteSession.webRequest.onBeforeRequest((details, callback) => {
      if (details.resourceType !== "mainFrame") {
        callback({ cancel: false });
        return;
      }
      const route =
        details.webContentsId === undefined
          ? undefined
          : routes.get(details.webContentsId);
      let allowed = false;
      try {
        allowed = Boolean(route?.(details.url));
      } catch {
        /* Fail closed before sending a page request. */
      }
      callback({ cancel: !allowed });
    });
  }
  gates.set(id, allow);
  return () => {
    gates!.delete(id);
    if (!gates!.size) {
      siteSession.webRequest.onBeforeRequest(null);
      navigationGates.delete(siteSession);
    }
  };
}

export async function assertSourceBrowserEnabled() {
  const preferences = await db.get<string, UserPreferences>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );
  if (!isSourceBrowsingEnabled(preferences))
    throw new Error(
      "Source website browsing is disabled in Advanced settings."
    );
}

export function assertSourceBrowserOwner(event: IpcMainInvokeEvent) {
  const owners = [WindowManager.mainWindow, WindowManager.bigPictureWindow];
  if (
    event.senderFrame !== event.sender.mainFrame ||
    !owners.some((win) => win?.webContents === event.sender)
  )
    throw new Error("Source browser caller is not a Hydra app window.");
}

export async function getSourceWebsiteProfiles(): Promise<Profiles> {
  const saved =
    (await db.get<string, Profiles>(profilesKey, { valueEncoding: "json" })) ??
    {};
  return Object.fromEntries(
    Object.entries(saved).map(([id, profile]) => [
      id,
      validateWebsiteProfile(profile),
    ])
  );
}

let profileUpdates: Promise<unknown> = Promise.resolve();
export function saveSourceWebsiteProfile(
  id: string,
  profile: SourceWebsiteProfile
) {
  const next = profileUpdates.then(async () => {
    if (
      !id ||
      id.length > 500 ||
      ["__proto__", "constructor", "prototype"].includes(id)
    )
      throw new Error("Invalid source identifier.");
    const profiles = await getSourceWebsiteProfiles();
    await db.put(
      profilesKey,
      { ...profiles, [id]: validateWebsiteProfile(profile) },
      { valueEncoding: "json" }
    );
    profileGeneration++;
    for (const browser of browsers.values())
      if (browser.sourceId === id) browser.close();
  });
  profileUpdates = next.catch(() => {});
  return next;
}

export function closeSourceBrowsers() {
  for (const browser of browsers.values()) browser.close();
}

export async function clearSourceWebsiteData(id: string) {
  // Close first so a live site cannot immediately recreate cookies.
  closeSourceBrowsers();
  const siteSession = session.fromPartition(partition(id));
  await siteSession.clearStorageData();
  await siteSession.clearCache();
  await siteSession.clearAuthCache();
}

export async function openSourceBrowser(
  event: IpcMainInvokeEvent,
  request: SourceBrowserRequest
): Promise<GameRepack | null> {
  assertSourceBrowserOwner(event);
  await assertSourceBrowserEnabled();
  const websiteProfileId =
    request?.websiteProfileId ?? request?.repack?.downloadSourceId;
  if (
    !websiteProfileId ||
    !request.objectId ||
    !request.gameTitle ||
    !request.repack.title
  )
    throw new Error("Missing source or game context.");
  const sourceId = websiteProfileId;
  const requestKey = sourceBrowserRequestKey(request);
  const generation = profileGeneration;
  const profile = (await getSourceWebsiteProfiles())[sourceId] ?? null;
  await assertSourceBrowserEnabled();
  if (generation !== profileGeneration)
    throw new Error(
      "Website permissions changed. Open the source browser again."
    );
  const existing = [...browsers.values()].find(
    (browser) =>
      browser.owner === event.sender.id && browser.requestKey === requestKey
  );
  if (existing) {
    if (!existing.window.isDestroyed()) {
      if (existing.window.isMinimized()) existing.window.restore();
      existing.window.focus();
      return null;
    }
    for (const [id, browser] of browsers)
      if (browser === existing) browsers.delete(id);
  }
  const isWebsiteSelection = request.repack.sourceOrigin === "website";
  const isWebsiteSearch = isWebsiteSelection && request.readOnly !== true;
  const exact = isWebsiteSearch ? "" : (request.repack.sourcePageUrl ?? "");
  const sourceName = isWebsiteSelection
    ? (profile?.name ??
      (profile ? new URL(profile.website).hostname : "Website"))
    : request.repack.downloadSourceName;
  const state: SourceBrowserState = {
    readOnly: request.readOnly === true,
    title: request.gameTitle,
    releaseTitle: isWebsiteSearch ? "" : request.repack.title,
    sourceName,
    url: "",
    pageUrl: "",
    lookup: !profile ? "setup" : exact ? "exact" : "search",
    loading: false,
    error: "",
    links: [],
    profile,
    blockedNavigation: null,
  };
  const win = new BrowserWindow({
    width: 1300,
    height: 900,
    minWidth: 960,
    minHeight: 650,
    title: `${sourceName} · ${request.gameTitle} — Hydra Ludusavi`,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/source-browser.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  const siteSession = session.fromPartition(partition(sourceId));
  // Use this Electron runtime's Chromium identity for ordinary website browsing.
  // App-branded defaults can be rejected by a site's browser compatibility rules.
  siteSession.setUserAgent(sourceWebsiteUserAgent(siteSession.getUserAgent()));
  siteSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false)
  );
  siteSession.setPermissionCheckHandler(() => false);
  const view = new WebContentsView({
    webPreferences: {
      session: siteSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
    },
  });
  win.contentView.addChildView(view);
  const controllerId = win.webContents.id;
  const resize = () => {
    const [width, height] = win.getContentSize();
    view.setBounds({
      x: 0,
      y: 146,
      width: Math.max(0, width - 390),
      height: Math.max(0, height - 146),
    });
  };
  resize();
  win.on("resize", resize);
  let done = false;
  let resolveResult: (result: GameRepack | null) => void;
  const result = new Promise<GameRepack | null>((resolve) => {
    resolveResult = resolve;
  });
  const emit = () => {
    if (!win.isDestroyed()) win.webContents.send("source-browser-state", state);
  };
  const setError = (message: string) => {
    state.error = message;
    emit();
  };
  const collect = (raw: string) => {
    if (state.readOnly) return false;
    if (
      !profile ||
      !state.pageUrl ||
      sourceGamePageKind(state.pageUrl, request.gameTitle, profile) !== "game"
    )
      return false;
    try {
      const link = supportedSourceLink(raw);
      if (state.links.length >= 100)
        throw new Error("Selection limit is 100 links.");
      if (!state.links.includes(link)) state.links.push(link);
      state.error = "";
      state.blockedNavigation = null;
      emit();
      return true;
    } catch {
      return false;
    }
  };
  const permitNavigation = (raw: string): boolean => {
    const decision = sourceNavigationDecision(raw, profile);
    if (decision.action === "block") {
      state.blockedNavigation = decision.blocked;
      setError(decision.blocked.message);
      return false;
    }
    if (decision.action === "collect") {
      if (!collect(decision.url))
        setError(
          state.readOnly
            ? "Download links cannot be selected in this inspection window."
            : "The download link could not be collected."
        );
      return false;
    }
    if (
      !profile ||
      sourceGamePageKind(decision.url, request.gameTitle, profile) === "blocked"
    ) {
      state.blockedNavigation = {
        hostname: new URL(decision.url).hostname,
        reason: "different-game",
        message:
          "Blocked this page because its address does not match the selected game or its search. Some legitimate pages may use a different title or address.",
      };
      setError(state.blockedNavigation.message);
      return false;
    }
    state.blockedNavigation = null;
    state.error = "";
    emit();
    return true;
  };
  const unregisterNavigationGate = registerNavigationGate(
    siteSession,
    view.webContents.id,
    permitNavigation
  );
  const load = (raw: string) => {
    if (!permitNavigation(raw)) return;
    try {
      const url = websiteUrl(raw).href;
      void view.webContents.loadURL(url).catch((error) => {
        if (error.code === "ERR_ABORTED" || state.blockedNavigation) return;
        setError(
          "This website could not load. Try reloading or Open in browser, then paste a supported link."
        );
      });
    } catch (error) {
      setError((error as Error).message);
    }
  };
  const navigation = (e: Electron.Event, raw: string) => {
    if (!permitNavigation(raw)) e.preventDefault();
  };
  view.webContents.on("will-navigate", navigation);
  view.webContents.on("will-redirect", (event, url, _inPlace, isMainFrame) => {
    if (isMainFrame) navigation(event, url);
  });
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (!collect(url) && permitNavigation(url))
      setError(
        "A website requested a popup. Right-click the link to open it in this window, or use Open in browser."
      );
    return { action: "deny" };
  });
  view.webContents.on("context-menu", (_e, params) => {
    if (!params.linkURL) return;
    Menu.buildFromTemplate([
      {
        label: "Add link to selection",
        click: () => {
          if (!collect(params.linkURL))
            setError("This is not a supported magnet or hoster download link.");
        },
      },
      {
        label: "Open link in this window",
        click: () => load(params.linkURL),
      },
    ]).popup({ window: win });
  });
  const onDownload = (
    e: Electron.Event,
    item: Electron.DownloadItem,
    contents: Electron.WebContents
  ) => {
    e.preventDefault();
    if (contents !== view.webContents) return;
    if (!collect(item.getURL()))
      setError(
        "Browser file downloads are blocked. Select a supported hoster or magnet link, then review it in Hydra."
      );
  };
  siteSession.on("will-download", onDownload);
  view.webContents.on("did-start-loading", () => {
    state.loading = true;
    emit();
  });
  view.webContents.on("did-stop-loading", () => {
    state.loading = false;
    emit();
  });
  const onPage = (_e: Electron.Event, url: string) => {
    if (
      !profile ||
      sourceGamePageKind(url, request.gameTitle, profile) === "blocked"
    ) {
      const previous = state.pageUrl;
      state.links = [];
      state.pageUrl = "";
      setError("Blocked a page that does not match the selected game.");
      if (previous) load(previous);
      return;
    }
    if (state.pageUrl && state.pageUrl !== url) state.links = [];
    state.url = url;
    if (sourceNavigationDecision(url, profile).action === "allow")
      state.pageUrl = url;
    emit();
  };
  view.webContents.on("did-navigate", (event, url, status) => {
    onPage(event, url);
    if (!state.blockedNavigation) state.error = sourceWebsiteHttpError(status);
    emit();
  });
  view.webContents.on("did-navigate-in-page", onPage);
  view.webContents.on(
    "did-fail-load",
    (_e, code, _description, _url, mainFrame) => {
      if (mainFrame && code !== -3 && !state.blockedNavigation)
        setError(
          "Website unavailable or blocked in this browser. Try Open in browser and paste a supported link."
        );
    }
  );
  view.webContents.on("render-process-gone", () =>
    setError(
      "The website stopped responding. Reload it or open it in your browser."
    )
  );
  view.webContents.on("will-attach-webview", (e) => e.preventDefault());
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const finish = (selection: GameRepack | null) => {
    if (done) return;
    done = true;
    browsers.delete(controllerId);
    resolveResult(selection);
    win.close();
  };
  browsers.set(win.webContents.id, {
    window: win,
    owner: event.sender.id,
    sourceId,
    requestKey,
    close: () => finish(null),
  });
  const ownerGone = () => finish(null);
  event.sender.once("destroyed", ownerGone);
  win.once("closed", () => {
    browsers.delete(controllerId);
    event.sender.removeListener("destroyed", ownerGone);
    siteSession.removeListener("will-download", onDownload);
    unregisterNavigationGate();
    if (!view.webContents.isDestroyed()) view.webContents.close();
    if (!done) {
      done = true;
      resolveResult(null);
    }
  });
  const { ipcMain } = await import("electron");
  const commandChannel = `source-browser-command-${win.webContents.id}`;
  const stateChannel = `source-browser-state-${win.webContents.id}`;
  const checkChrome = async (caller: IpcMainInvokeEvent) => {
    await assertSourceBrowserEnabled();
    if (
      caller.sender !== win.webContents ||
      caller.senderFrame !== win.webContents.mainFrame
    )
      throw new Error("Invalid browser controller.");
  };
  ipcMain.handle(stateChannel, async (caller) => {
    await checkChrome(caller);
    return state;
  });
  ipcMain.handle(
    commandChannel,
    async (caller, command: SourceBrowserCommand) => {
      await checkChrome(caller);
      switch (command.action) {
        case "navigate":
          load(command.url);
          break;
        case "add":
          if (!collect(command.url))
            throw new Error("Unsupported link or selection limit reached.");
          break;
        case "back":
          if (view.webContents.navigationHistory.canGoBack())
            view.webContents.navigationHistory.goBack();
          break;
        case "forward":
          if (view.webContents.navigationHistory.canGoForward())
            view.webContents.navigationHistory.goForward();
          break;
        case "reload":
          view.webContents.reload();
          break;
        case "external":
          if (
            sourceNavigationDecision(state.url || state.pageUrl, profile)
              .action !== "allow"
          )
            throw new Error(
              "Only approved page addresses can be opened externally from this window."
            );
          await shell.openExternal(websiteUrl(state.url || state.pageUrl).href);
          break;
        case "close":
          finish(null);
          break;
        case "remove":
        case "up":
        case "down": {
          const i = command.index;
          if (!Number.isInteger(i) || i < 0 || i >= state.links.length)
            throw new Error("Invalid selection index.");
          if (command.action === "remove") state.links.splice(i, 1);
          else {
            const to = i + (command.action === "up" ? -1 : 1);
            if (to >= 0 && to < state.links.length)
              [state.links[i], state.links[to]] = [
                state.links[to],
                state.links[i],
              ];
          }
          break;
        }
        case "review": {
          if (
            !state.pageUrl ||
            sourceNavigationDecision(state.pageUrl, profile).action !==
              "allow" ||
            !profile ||
            sourceGamePageKind(state.pageUrl, request.gameTitle, profile) !==
              "game"
          )
            throw new Error(
              "Open an approved source page before reviewing download links."
            );
          if (state.readOnly)
            throw new Error(
              "This window is for viewing an existing download's source only."
            );
          if (command.acknowledged !== true)
            throw new Error(
              "Confirm the release title and link selection first."
            );
          let links = [...state.links];
          if (command.mode === "mirrors") {
            const index = command.mirrorIndex;
            if (
              !Number.isInteger(index) ||
              index! < 0 ||
              index! >= links.length
            )
              throw new Error("Choose one mirror to send to Hydra.");
            links = [links[index!]];
          }
          if (command.mode === "parts")
            await assertMultipartHosterDownloadsEnabled();
          const selection = buildSourceSelection(
            request.repack,
            links,
            command.mode,
            command.releaseTitle,
            state.pageUrl || state.url
          );
          await assertSourceBrowserEnabled();
          finish(selection);
          break;
        }
        default:
          throw new Error("Unsupported browser operation.");
      }
      emit();
    }
  );
  win.once("closed", () => {
    ipcMain.removeHandler(commandChannel);
    ipcMain.removeHandler(stateChannel);
  });
  // The dedicated chrome has only its narrow preload; websites get no preload.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  const chromeUrl = devUrl ? new URL("source-browser.html", devUrl).href : null;
  const controllerQuery = `controller=${win.webContents.id}`;
  try {
    if (chromeUrl) await win.loadURL(`${chromeUrl}?${controllerQuery}`);
    else
      await win.loadFile(
        path.join(__dirname, "../renderer/source-browser.html"),
        { query: { controller: String(controllerId) } }
      );
  } catch {
    finish(null);
    throw new Error("Source browser controls could not load.");
  }
  if (!done && !event.sender.isDestroyed()) {
    event.sender.send("on-source-browser-opened", requestKey);
  }
  if (exact) load(exact);
  else if (profile)
    load(
      profile.searchUrl.replaceAll(
        "{query}",
        encodeURIComponent(sourceSearchQuery(request.gameTitle))
      )
    );
  return result;
}
