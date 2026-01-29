const logEl = document.getElementById("log");
const form = document.getElementById("form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const resetSoftBtn = document.getElementById("reset-soft");
const resetHardBtn = document.getElementById("reset-hard");
const rebuildBtn = document.getElementById("rebuild");
const minTokensInput = document.getElementById("min-tokens");
const maxTokensInput = document.getElementById("max-tokens");
const smoothingSelect = document.getElementById("smoothing-mode");
const addKWrap = document.getElementById("add-k-wrap");
const addKInput = document.getElementById("add-k");
const joinerSelect = document.getElementById("joiner");

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseLine(line) {
  const match = String(line).match(/^([UA]):\s?(.*)$/);
  if (!match) return { role: "user", text: line };
  return { role: match[1] === "A" ? "assistant" : "user", text: match[2] };
}

function renderLog(lines) {
  logEl.innerHTML = "";
  for (const line of lines) {
    const { role, text } = parseLine(line);
    const div = document.createElement("div");
    div.className = `line ${role}`;
    div.innerHTML = escapeHtml(text || "");
    logEl.appendChild(div);
  }
  logEl.scrollTop = logEl.scrollHeight;
}

async function fetchLog() {
  const res = await fetch("/api/log");
  const data = await res.json();
  renderLog(data.lines || []);
}

async function sendMessage(text) {
  const minTokens = Number(minTokensInput.value);
  const maxTokens = Number(maxTokensInput.value);
  const smoothingMode = smoothingSelect.value;
  const addK = Number(addKInput.value);
  const joiner = joinerSelect.value;
  const res = await fetch("/api/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      opts: {
        minTokens,
        maxTokens,
        smoothingMode,
        addK,
        joiner
      }
    })
  });
  if (!res.ok) throw new Error("送信に失敗しました");
  await fetchLog();
}

async function doReset(mode) {
  await fetch("/api/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode })
  });
  await fetchLog();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  sendBtn.disabled = true;
  try {
    await sendMessage(text);
    input.value = "";
    input.focus();
  } catch (err) {
    alert(err.message || "エラーが発生しました");
  } finally {
    sendBtn.disabled = false;
  }
});

resetSoftBtn.addEventListener("click", async () => {
  if (!confirm("チャットと学習状態を消去します。続行しますか？")) return;
  await doReset("soft");
});

resetHardBtn.addEventListener("click", async () => {
  if (!confirm("チャットとモデルを消去します。続行しますか？")) return;
  await doReset("hard");
});

rebuildBtn.addEventListener("click", async () => {
  if (!confirm("vocab/model/stateを初期化して作り直します。続行しますか？")) return;
  await doReset("rebuild");
});

function syncAddKVisibility() {
  if (smoothingSelect.value === "add-k") {
    addKWrap.classList.remove("hidden");
  } else {
    addKWrap.classList.add("hidden");
  }
}

if (new URLSearchParams(window.location.search).get("debug") === "1") {
  rebuildBtn.classList.remove("hidden");
}

syncAddKVisibility();
smoothingSelect.addEventListener("change", syncAddKVisibility);

fetchLog();
