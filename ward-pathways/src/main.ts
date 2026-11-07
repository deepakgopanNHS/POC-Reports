import { ensureSignedInWithFabric, initEmbeddedAuth } from "@microsoft/rayfin-auth-provider-fabric";
import "./style.css";
import { client, fabricOptions } from "./data/client";
import { loadWardData } from "./data/load";
import { mountExplorer } from "./explorer";

const root = document.getElementById("app")!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function showState(html: string): void {
  root.innerHTML = `<div class="state">${html}</div>`;
}
function showLoading(message = "Loading ward movements from the semantic model…"): void {
  showState(`<div class="spinner" aria-hidden="true"></div><p>${esc(message)}</p>`);
}
function showSignIn(message = "Sign in with your Fabric account to view live data."): void {
  showState(`<img class="state-logo" src="/brand/nlft-logo.png" alt="North London NHS Foundation Trust" />
    <h1>Ward pathways</h1>
    <p>${esc(message)}</p>
    <button type="button" data-action="sign-in">Sign in with Microsoft</button>`);
}
function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : "An unexpected error occurred.";
  showState(`<h1>The ward data could not be loaded</h1>
    <p>${esc(message)}</p>
    <p>Check your Fabric sign-in and access to the Ward_Movement semantic model, then try again.</p>
    <button type="button" data-action="reload">Try again</button>`);
}

async function loadAndRender(): Promise<void> {
  showLoading();
  try {
    const data = await loadWardData();
    if (!data.spells.length) throw new Error("The semantic model returned no spells.");
    mountExplorer(root, data, () => void loadAndRender());
  } catch (error) {
    showError(error);
  }
}

root.addEventListener("click", async (event) => {
  const action = (event.target as Element | null)?.closest<HTMLElement>("[data-action]")?.dataset.action;
  if (action === "reload") await loadAndRender();
  if (action === "sign-in") {
    showLoading("Completing Microsoft Fabric sign-in…");
    try {
      await ensureSignedInWithFabric(client.auth, fabricOptions);
      await loadAndRender();
    } catch (error) {
      showSignIn(error instanceof Error ? `Sign-in failed: ${error.message}` : "Sign-in failed. Try again or check your Fabric access.");
    }
  }
});

async function start(): Promise<void> {
  showLoading();
  try {
    const embedded = await initEmbeddedAuth(client.auth, fabricOptions);
    const session = embedded ?? client.auth.getSession();
    if (!session?.isAuthenticated) {
      showSignIn();
      return;
    }
    await loadAndRender();
  } catch (error) {
    showError(error);
  }
}

void start();
