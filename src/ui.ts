// Single-page upload UI. Talks to the same /api endpoints as any API client.
export const UI_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Document OCR</title>
<style>
  :root { --bg:#f7f7f8; --card:#fff; --fg:#1b1b1f; --muted:#6b6b76; --border:#e2e2e8; --accent:#2f6fec; --danger:#c62828; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#121214; --card:#1c1c20; --fg:#ececf1; --muted:#9a9aa6; --border:#2e2e35; --accent:#6f9bff; --danger:#ff6b6b; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui, sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 0 0 12px; }
  .muted { color: var(--muted); font-size: 13px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:16px; margin-top:16px; }
  label { display:block; font-size:13px; color:var(--muted); margin-bottom:4px; }
  input[type=text], input[type=password], input[type=number], select, textarea {
    width:100%; padding:8px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--fg); font:inherit;
  }
  .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:12px; }
  .checks label { display:flex; gap:8px; align-items:center; color:var(--fg); font-size:14px; margin:6px 0; }
  button { padding:8px 14px; border:0; border-radius:6px; background:var(--accent); color:#fff; font:inherit; cursor:pointer; }
  button.secondary { background:transparent; color:var(--accent); border:1px solid var(--border); }
  button.danger { background:transparent; color:var(--danger); border:1px solid var(--border); }
  button:disabled { opacity:.5; cursor:wait; }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:12px; }
  textarea { min-height: 320px; font-size: 15px; line-height: 1.7; }
  .bar { height:8px; background:var(--border); border-radius:4px; overflow:hidden; margin-top:6px; }
  .bar > div { height:100%; background:var(--accent); }
  .error { color: var(--danger); margin-top: 8px; white-space: pre-wrap; }
  table { width:100%; border-collapse: collapse; font-size: 14px; }
  td, th { text-align:start; padding:6px 4px; border-bottom:1px solid var(--border); vertical-align: top; }
  .hidden { display:none; }
</style>
</head>
<body>
<main>
  <h1>Document OCR</h1>
  <div class="muted">Google Document AI: PDF or image to Markdown / text.</div>

  <div class="card" id="auth-card">
    <h2>API token</h2>
    <div class="muted">Not needed if this site is behind Cloudflare Access. Saved in this browser only.</div>
    <div class="row"><input type="password" id="token" placeholder="Bearer token" style="flex:1"><button class="secondary" id="save-token">Save</button></div>
  </div>

  <div class="card">
    <h2>Usage</h2>
    <div id="usage" class="muted">Loading...</div>
  </div>

  <div class="card">
    <h2>New OCR</h2>
    <form id="form">
      <label for="file">File (PDF, PNG, JPEG, WEBP, BMP)</label>
      <input type="file" id="file" name="file" accept="application/pdf,image/png,image/jpeg,image/webp,image/bmp" required>
      <div id="limits" class="muted" style="margin-top:4px"></div>
      <div class="grid" style="margin-top:12px">
        <div><label for="pages">Pages (optional, e.g. 1-5,8)</label><input type="text" id="pages" name="pages" placeholder="all"></div>
        <div><label for="language_hints">Language hints (optional)</label><input type="text" id="language_hints" name="language_hints" placeholder="auto-detect, or ar,en"></div>
        <div><label for="retention_days">Keep result (days)</label><input type="number" id="retention_days" name="retention_days" min="1"></div>
        <div><label for="processor_version">Processor version (optional)</label><input type="text" id="processor_version" name="processor_version" placeholder="default"></div>
      </div>
      <div class="checks grid" style="margin-top:8px">
        <div>
          <label><input type="checkbox" name="native_pdf_parsing" id="native_pdf_parsing"> Use embedded PDF text</label>
          <label><input type="checkbox" name="image_quality_scores"> Page quality scores</label>
        </div>
        <div>
          <label><input type="checkbox" name="page_markers" checked> Page markers</label>
          <label><input type="checkbox" name="join_lines" checked> Join lines in paragraphs (md)</label>
        </div>
        <div id="premium" class="hidden">
          <label><input type="checkbox" name="math_ocr"> Math OCR (extra cost)</label>
          <label><input type="checkbox" name="selection_marks"> Checkboxes (extra cost)</label>
          <label><input type="checkbox" name="style_info"> Font style (extra cost)</label>
        </div>
      </div>
      <div class="row"><button type="submit" id="submit">Run OCR</button><span id="status" class="muted"></span></div>
      <div id="error" class="error"></div>
    </form>
  </div>

  <div class="card hidden" id="result-card">
    <h2 id="result-title">Result</h2>
    <div class="row" style="margin-top:0">
      <select id="view" style="width:auto"><option value="md">Markdown</option><option value="txt">Text</option></select>
      <button class="secondary" id="copy">Copy</button>
      <button class="secondary" data-dl="md">Download .md</button>
      <button class="secondary" data-dl="txt">Download .txt</button>
    </div>
    <textarea id="output" dir="auto" readonly style="margin-top:12px"></textarea>
    <div id="result-meta" class="muted"></div>
  </div>

  <div class="card">
    <h2>History</h2>
    <div id="history" class="muted">Loading...</div>
  </div>
</main>
<script>
const $ = (id) => document.getElementById(id);
let token = "";
try { token = localStorage.getItem("ocr_token") || ""; } catch {}
$("token").value = token;
$("save-token").onclick = () => {
  token = $("token").value.trim();
  try { localStorage.setItem("ocr_token", token); } catch {}
  refresh();
};

async function api(path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (token) headers.set("authorization", "Bearer " + token);
  const res = await fetch("/api" + path, { ...init, headers, credentials: "same-origin" });
  if (!res.ok) {
    let msg = res.status + " " + res.statusText;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res;
}

let current = null; // { id, filename, md, txt }

async function loadConfig() {
  const cfg = await (await api("/config")).json();
  $("limits").textContent = "Max " + cfg.maxPagesPerFile + " pages and " + cfg.maxFileMB + " MB per file.";
  $("retention_days").value = cfg.retentionDays;
  $("retention_days").max = cfg.maxRetentionDays;
  $("language_hints").value = (cfg.defaultLanguageHints || []).join(",");
  $("native_pdf_parsing").checked = cfg.defaultNativePdfParsing;
  $("premium").classList.toggle("hidden", !cfg.allowPremiumFeatures);
}

function usageLine(label, u) {
  if (!u.limit) return "<div>" + label + ": " + u.used + " pages (no limit)</div>";
  const pct = Math.min(100, Math.round((u.used / u.limit) * 100));
  return "<div style='margin-bottom:8px'>" + label + ": " + u.used + " / " + u.limit + " pages<div class='bar'><div style='width:" + pct + "%'></div></div></div>";
}

async function loadUsage() {
  const u = await (await api("/usage")).json();
  $("usage").innerHTML = usageLine("This month (" + u.month.period + ")", u.month) + usageLine("Today", u.day);
}

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

async function loadHistory() {
  const { jobs } = await (await api("/jobs")).json();
  if (!jobs.length) { $("history").textContent = "No saved results."; return; }
  $("history").innerHTML = "<table><tr><th>File</th><th>Pages</th><th>Status</th><th>Expires</th><th></th></tr>" +
    jobs.map((j) => "<tr><td dir='auto'>" + esc(j.filename) + (j.error ? "<div class='error'>" + esc(j.error) + "</div>" : "") + "</td><td>" + j.pages +
      "</td><td>" + j.status + "</td><td>" + new Date(j.expiresAt).toLocaleDateString() + "</td><td style='white-space:nowrap'>" +
      (j.status === "done" ? "<button class='secondary' data-open='" + j.id + "'>Open</button> " : "") +
      "<button class='danger' data-del='" + j.id + "'>Delete</button></td></tr>").join("") + "</table>";
  $("history").dataset.jobs = JSON.stringify(jobs.map((j) => [j.id, j.filename]));
}

async function refresh() {
  try { await Promise.all([loadConfig(), loadUsage(), loadHistory()]); }
  catch (e) { $("usage").textContent = e.message; $("history").textContent = ""; }
}

async function openJob(id, filename) {
  const [md, txt] = await Promise.all([api("/jobs/" + id + "/md").then((r) => r.text()), api("/jobs/" + id + "/txt").then((r) => r.text())]);
  current = { id, filename, md, txt };
  $("result-title").textContent = filename;
  $("result-card").classList.remove("hidden");
  showView();
}

function showView() { if (current) $("output").value = current[$("view").value]; }
$("view").onchange = showView;
$("copy").onclick = () => navigator.clipboard.writeText($("output").value);

document.addEventListener("click", async (e) => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  if (t.dataset.dl && current) {
    const blob = await (await api("/jobs/" + current.id + "/" + t.dataset.dl + "?download")).blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = current.filename.replace(/\\.[^.]+$/, "") + "." + t.dataset.dl;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  if (t.dataset.open) {
    const name = new Map(JSON.parse($("history").dataset.jobs || "[]")).get(t.dataset.open) || "Result";
    openJob(t.dataset.open, name).catch((err) => alert(err.message));
  }
  if (t.dataset.del && confirm("Delete this result?")) {
    await api("/jobs/" + t.dataset.del, { method: "DELETE" });
    if (current && current.id === t.dataset.del) { current = null; $("result-card").classList.add("hidden"); }
    loadHistory();
  }
});

$("form").onsubmit = async (e) => {
  e.preventDefault();
  $("error").textContent = "";
  const form = new FormData($("form"));
  for (const name of ["native_pdf_parsing", "image_quality_scores", "page_markers", "join_lines", "math_ocr", "selection_marks", "style_info"]) {
    const box = $("form").querySelector("[name=" + name + "]");
    form.set(name, box && box.checked ? "true" : "false");
  }
  form.set("format", "none");
  $("submit").disabled = true;
  $("status").textContent = "Processing...";
  try {
    const res = await (await api("/ocr", { method: "POST", body: form })).json();
    $("status").textContent = "Done: " + res.pages + " page(s).";
    await openJob(res.id, res.filename);
    const q = (res.meta.pages || []).filter((p) => p.qualityScore !== undefined);
    $("result-meta").textContent = q.length ? "Quality: " + q.map((p) => "p" + p.page + " " + p.qualityScore.toFixed(2) + (p.defects.length ? " (" + p.defects.join(", ") + ")" : "")).join(" | ") : "";
    loadUsage(); loadHistory();
  } catch (err) {
    $("status").textContent = "";
    $("error").textContent = err.message;
  } finally {
    $("submit").disabled = false;
  }
};

refresh();
</script>
</body>
</html>`;
