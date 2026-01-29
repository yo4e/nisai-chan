const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const CHAT_PATH = path.join(DATA_DIR, "chat.txt");
const VOCAB_PATH = path.join(DATA_DIR, "vocab.json");
const MODEL_PATH = path.join(DATA_DIR, "model.json");
const STATE_PATH = path.join(DATA_DIR, "state.json");

const DEFAULTS = {
  MAX_LOG_LINES: 1000
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function ensureFile(filePath, defaultContent = "") {
  ensureDataDir();
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, defaultContent, "utf8");
}

function readText(filePath) {
  ensureFile(filePath, "");
  return fs.readFileSync(filePath, "utf8");
}

function writeText(filePath, text) {
  ensureDataDir();
  fs.writeFileSync(filePath, text, "utf8");
}

function readLines() {
  const text = readText(CHAT_PATH);
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function writeLines(lines) {
  const text = lines.length ? lines.join("\n") + "\n" : "";
  writeText(CHAT_PATH, text);
}

function sanitizeLine(text) {
  return String(text).replace(/[\r\n]+/g, " ").trim();
}

function appendLine(role, text) {
  const safeRole = role === "A" ? "A" : "U";
  const line = `${safeRole}: ${sanitizeLine(text)}`;
  let lines = readLines();
  lines.push(line);
  if (lines.length > DEFAULTS.MAX_LOG_LINES) {
    lines = lines.slice(lines.length - DEFAULTS.MAX_LOG_LINES);
  }
  writeLines(lines);
  return lines;
}

function readJSON(filePath, fallback) {
  ensureFile(filePath, "");
  const text = fs.readFileSync(filePath, "utf8");
  if (!text.trim()) return fallback;
  return JSON.parse(text);
}

function writeJSON(filePath, obj) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
}

function readState() {
  return readJSON(STATE_PATH, { trainedLine: 0 });
}

function writeState(state) {
  writeJSON(STATE_PATH, state);
}

function readVocab() {
  return readJSON(VOCAB_PATH, null);
}

function writeVocab(vocab) {
  writeJSON(VOCAB_PATH, vocab);
}

function readModel() {
  return readJSON(MODEL_PATH, null);
}

function writeModel(model) {
  writeJSON(MODEL_PATH, model);
}

function resetSoft() {
  writeText(CHAT_PATH, "");
  writeState({ trainedLine: 0 });
}

function resetHard() {
  resetSoft();
  writeModel(null);
}

function resetRebuild(keepChat = true) {
  if (!keepChat) writeText(CHAT_PATH, "");
  writeState({ trainedLine: 0 });
  writeModel(null);
  writeVocab(null);
}

function deleteVocab() {
  writeVocab(null);
}

module.exports = {
  CHAT_PATH,
  VOCAB_PATH,
  MODEL_PATH,
  STATE_PATH,
  DEFAULTS,
  readLines,
  writeLines,
  appendLine,
  readState,
  writeState,
  readVocab,
  writeVocab,
  readModel,
  writeModel,
  resetSoft,
  resetHard,
  resetRebuild,
  deleteVocab
};
