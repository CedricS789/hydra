import type {
  SourceBrowserApi,
  SourceBrowserCommand,
  SourceBrowserState,
} from "../../types/source-browser.types";
import "./source-browser.css";

const api = (window as unknown as { sourceBrowser: SourceBrowserApi })
  .sourceBrowser;
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);
let current: SourceBrowserState | null = null;
let initialized = false;
const fail = (error: unknown) => {
  element("error").textContent =
    error instanceof Error ? error.message : String(error);
};
const command = async (value: SourceBrowserCommand) => {
  try {
    await api.command(value);
  } catch (error) {
    fail(error);
  }
};
const updateReview = () => {
  element<HTMLButtonElement>("review-button").disabled =
    !current?.links.length ||
    !current?.pageUrl ||
    !input("acknowledged").checked ||
    !input("release-title").value.trim();
};
function render(state: SourceBrowserState) {
  const selectionChanged = current?.links.join("\n") !== state.links.join("\n");
  current = state;
  element("review").hidden = state.readOnly;
  element("add").hidden = state.readOnly;
  element("heading").textContent = `${state.sourceName} · ${state.title}`;
  if (document.activeElement !== input("address"))
    input("address").value = state.url;
  element("status").textContent =
    `${state.loading ? "Loading… · " : ""}${state.lookup === "exact" ? "Original release page supplied" : state.lookup === "search" ? "Source search: choose the matching release and version" : "Set up this source website to begin"}`;
  element("error").textContent = state.error;
  element("blocked-destination").hidden = !state.blockedNavigation;
  element("blocked-destination").textContent = state.blockedNavigation?.hostname
    ? `Blocked destination: ${state.blockedNavigation.hostname}`
    : "Blocked incompatible address.";
  element<HTMLButtonElement>("external").disabled =
    !state.profile || !state.url;
  if (state.error) element("status").textContent = state.error;
  element("status").classList.toggle(
    "source-browser-error",
    Boolean(state.error)
  );
  if (!initialized) {
    initialized = true;
    input("release-title").value = state.releaseTitle;
  }
  element("count").textContent = String(state.links.length);
  const list = element("links");
  list.replaceChildren();
  for (const [index, link] of state.links.entries()) {
    const li = document.createElement("li");
    const text = document.createElement("span");
    const url = new URL(link);
    text.textContent =
      url.protocol === "magnet:"
        ? `Magnet · ${url.searchParams.get("dn") || url.searchParams.get("xt")}`
        : `${url.hostname}${url.pathname}`;
    text.title = link;
    li.append(text);
    for (const [action, label] of [
      ["up", "↑"],
      ["down", "↓"],
      ["remove", "Remove"],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("aria-label", `${action} link ${index + 1}`);
      button.disabled =
        (action === "up" && index === 0) ||
        (action === "down" && index === state.links.length - 1);
      button.onclick = () => {
        input("acknowledged").checked = false;
        void command({ action, index });
      };
      li.append(button);
    }
    list.append(li);
  }
  const mirror = element<HTMLSelectElement>("mirror");
  const previousMirror = mirror.value;
  mirror.replaceChildren(
    ...state.links.map((link, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      const url = new URL(link);
      option.textContent = `${index + 1}. ${url.protocol === "magnet:" ? "Magnet" : url.hostname + url.pathname}`;
      return option;
    })
  );
  if (previousMirror) mirror.value = previousMirror;
  if (selectionChanged) input("acknowledged").checked = false;
  updateReview();
}
for (const action of [
  "back",
  "forward",
  "reload",
  "external",
  "close",
] as const)
  element(action).onclick = () => void command({ action });
element<HTMLFormElement>("navigate").onsubmit = (event) => {
  event.preventDefault();
  void command({ action: "navigate", url: input("address").value });
};
element<HTMLFormElement>("add").onsubmit = (event) => {
  event.preventDefault();
  const value = input("link").value;
  void command({ action: "add", url: value });
};
element<HTMLFormElement>("review").onsubmit = (event) => {
  event.preventDefault();
  void command({
    action: "review",
    releaseTitle: input("release-title").value,
    mode: element<HTMLSelectElement>("mode").value as
      | "single"
      | "mirrors"
      | "parts",
    mirrorIndex: Number(element<HTMLSelectElement>("mirror").value),
    acknowledged: input("acknowledged").checked,
  });
};
input("acknowledged").onchange = updateReview;
input("release-title").oninput = () => {
  input("acknowledged").checked = false;
  updateReview();
};
element("mode").onchange = () => {
  element("mirror-label").hidden =
    element<HTMLSelectElement>("mode").value !== "mirrors";
  input("acknowledged").checked = false;
  updateReview();
};
element("mirror").onchange = () => {
  input("acknowledged").checked = false;
  updateReview();
};
api.onState(render);
void api.state().then(render).catch(fail);
