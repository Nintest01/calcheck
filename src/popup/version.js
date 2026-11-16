// Step 1 version gate: compare the installed version with manifest.json on GitHub (main).
// The GitHub link is fixed (not editable). On mismatch the popup offers a zip download of main.
import { cmpVersion, manifestVersion } from "../core/version.js";
import { $, GIT_MANIFEST_URL, GIT_ZIP_URL } from "./dom.js";

function gitErr(msg) { const e = $("gitErr"); e.textContent = msg || ""; e.classList.toggle("hide", !msg); }

// true = versions match, go on; false = stay on step 1 (mismatch -> version popup, failure -> red message)
export async function versionGate() {
  const btn = $("toForm"), label = btn.textContent, local = chrome.runtime.getManifest().version;
  btn.disabled = true; btn.textContent = "Checking version…"; gitErr("");
  try {
    const res = await fetch(GIT_MANIFEST_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const remote = manifestVersion(await res.text());
    if (!remote) throw new Error("no valid \"version\" in that file");
    const c = cmpVersion(local, remote);
    if (c === 0) return true;
    $("verLocal").textContent = local; $("verGit").textContent = remote;
    $("verDl").classList.toggle("hide", c > 0);
    $("verMsg").textContent = c < 0 ? "A newer version is on GitHub. Download the zip, unzip it over your CalCheck folder, then Reload the extension in chrome://extensions." : "The installed version is ahead of GitHub (main).";
    $("verModal").classList.remove("hide"); $("verClose").focus();
    return false;
  } catch (e) {
    gitErr("Could not check the version: " + ((e && e.message) || e));
    return false;
  } finally { btn.textContent = label; btn.disabled = false; }
}

$("verDl").onclick = () => window.open(GIT_ZIP_URL, "_blank");
$("verClose").onclick = () => $("verModal").classList.add("hide");
