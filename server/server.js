const express = require("express");
const path = require("path");
const io = require("./io");
const lm = require("./lm");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = "127.0.0.1";

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "web")));

function loadRuntime() {
  const lines = io.readLines();
  let model = io.readModel();
  model = lm.ensureModel(model);
  io.writeModel(model);

  const state = io.readState();
  if (state.trainedLine > lines.length) state.trainedLine = lines.length;

  return { lines, model, state };
}

app.get("/api/log", (req, res) => {
  const lines = io.readLines();
  res.json({ lines });
});

app.post("/api/say", (req, res) => {
  const role = req.body?.role === "A" ? "A" : "U";
  const text = req.body?.text ?? "";
  const lines = io.appendLine(role, text);
  res.json({ ok: true, lines });
});

app.post("/api/train", (req, res) => {
  const { lines, model, state } = loadRuntime();
  const result = lm.trainDiff(lines, state, model);
  io.writeState(state);
  io.writeModel(model);
  res.json({ ok: true, trainedTokens: result.trainedTokens, trainedLine: state.trainedLine });
});

app.post("/api/reply", (req, res) => {
  const text = req.body?.text ?? "";
  const opts = req.body?.opts ?? {};
  io.appendLine("U", text);

  const { lines, model, state } = loadRuntime();
  const result = lm.trainDiff(lines, state, model);
  io.writeState(state);
  io.writeModel(model);

  const tokens = lm.generateTokens(model, opts);
  const joiner = typeof opts.joiner === "string" ? opts.joiner : "";
  const reply = tokens.join(joiner);
  io.appendLine("A", reply);

  res.json({ reply, trainedTokens: result.trainedTokens });
});

app.post("/api/reset", (req, res) => {
  const mode = req.body?.mode || "soft";
  if (mode === "hard") {
    io.resetHard();
  } else if (mode === "rebuild") {
    io.resetRebuild(true);
  } else {
    io.resetSoft();
  }
  res.json({ ok: true, mode });
});

app.listen(PORT, HOST, () => {
  console.log(`nisai-chan server running at http://${HOST}:${PORT}`);
});
