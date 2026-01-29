const DEFAULT_CONFIG = {
  MAX_TOKENS: 20,
  MIN_TOKENS: 2,
  TEMP: 1.0,
  BOS: "<BOS>",
  EOS: "<EOS>",
  N: 3,
  SMOOTHING_MODE: "add-k",
  ADD_K: 0.001
};

const DEFAULT_META = {
  version: "2saichan-1",
  tokenizer: "same-as-issai",
  smoothing: "backoff",
  n: DEFAULT_CONFIG.N,
  bos: DEFAULT_CONFIG.BOS,
  eos: DEFAULT_CONFIG.EOS
};

function parseLine(line) {
  const match = String(line).match(/^([UA]):\s?(.*)$/);
  const role = match ? match[1] : "U";
  const text = match ? match[2] : String(line);
  return { role, text };
}

function isHiragana(ch) {
  const code = ch.charCodeAt(0);
  return code >= 0x3040 && code <= 0x309f;
}

function isKatakana(ch) {
  const code = ch.charCodeAt(0);
  return code >= 0x30a0 && code <= 0x30ff;
}

function isKanji(ch) {
  const code = ch.charCodeAt(0);
  return code >= 0x4e00 && code <= 0x9fff;
}

function isAsciiAlnum(ch) {
  const code = ch.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function charType(ch) {
  if (isHiragana(ch)) return "hiragana";
  if (isKatakana(ch)) return "katakana";
  if (isKanji(ch)) return "kanji";
  if (isAsciiAlnum(ch)) return "alnum";
  return "other";
}

function tokenize(text) {
  const tokens = [];
  let buffer = "";
  let lastType = null;

  for (const ch of text) {
    if (ch === " " || ch === "\t") {
      if (buffer) tokens.push(buffer);
      buffer = "";
      lastType = null;
      continue;
    }

    const type = charType(ch);
    if (type === "other") {
      if (buffer) tokens.push(buffer);
      buffer = "";
      lastType = null;
      if (ch !== "\n" && ch !== "\r") tokens.push(ch);
      continue;
    }

    if (type === lastType || !lastType) {
      buffer += ch;
    } else {
      if (buffer) tokens.push(buffer);
      buffer = ch;
    }
    lastType = type;
  }

  if (buffer) tokens.push(buffer);
  return tokens;
}

function buildEmptyModel(existingModel) {
  const normalizeConfig = (config) => {
    const normalized = { ...DEFAULT_CONFIG, ...(config || {}) };
    if (config && config.MAX_OUT_WORDS && !config.MAX_TOKENS) {
      normalized.MAX_TOKENS = config.MAX_OUT_WORDS;
    }
    return normalized;
  };

  if (existingModel && (existingModel.unigram || existingModel.bigram || existingModel.trigram || existingModel.meta)) {
    return {
      meta: { ...DEFAULT_META, ...(existingModel.meta || {}) },
      unigram: existingModel.unigram || {},
      bigram: existingModel.bigram || {},
      trigram: existingModel.trigram || {},
      config: normalizeConfig(existingModel.config),
      stats: existingModel.stats || { trainedTokens: 0 }
    };
  }

  if (existingModel && existingModel.counts) {
    const unigram = {};
    for (const prev of Object.keys(existingModel.counts)) {
      const nexts = existingModel.counts[prev] || {};
      for (const next of Object.keys(nexts)) {
        unigram[next] = (unigram[next] || 0) + nexts[next];
      }
    }
    return {
      meta: { ...DEFAULT_META },
      unigram,
      bigram: existingModel.counts || {},
      trigram: {},
      config: normalizeConfig(existingModel.config),
      stats: existingModel.stats || { trainedTokens: 0 }
    };
  }

  return {
    meta: { ...DEFAULT_META },
    unigram: {},
    bigram: {},
    trigram: {},
    config: { ...DEFAULT_CONFIG },
    stats: { trainedTokens: 0 }
  };
}

function ensureModel(existingModel) {
  return buildEmptyModel(existingModel);
}

function incUnigram(model, word) {
  if (!model.unigram[word]) model.unigram[word] = 0;
  model.unigram[word] += 1;
}

function incBigram(model, prev, next) {
  if (!model.bigram[prev]) model.bigram[prev] = {};
  if (!model.bigram[prev][next]) model.bigram[prev][next] = 0;
  model.bigram[prev][next] += 1;
}

function incTrigram(model, w1, w2, next) {
  const key = `${w1}|${w2}`;
  if (!model.trigram[key]) model.trigram[key] = {};
  if (!model.trigram[key][next]) model.trigram[key][next] = 0;
  model.trigram[key][next] += 1;
}

function trainDiff(lines, state, model) {
  const start = Math.min(state.trainedLine || 0, lines.length);
  const newLines = lines.slice(start);
  if (!newLines.length) return { trainedTokens: 0, state };

  let trained = 0;
  for (const line of newLines) {
    const { role, text } = parseLine(line);
    if (role !== "U") continue;
    const tokens = tokenize(text);
    const bos = model.config.BOS || DEFAULT_CONFIG.BOS;
    const eos = model.config.EOS || DEFAULT_CONFIG.EOS;
    const n = Math.max(2, Number(model.config.N || DEFAULT_CONFIG.N));
    const bosRepeat = Math.max(1, n - 1);
    const seq = Array.from({ length: bosRepeat }, () => bos).concat(tokens, eos);
    for (const token of seq) incUnigram(model, token);
    for (let i = 1; i < seq.length; i++) incBigram(model, seq[i - 1], seq[i]);
    for (let i = 2; i < seq.length; i++) incTrigram(model, seq[i - 2], seq[i - 1], seq[i]);
    trained += Math.max(seq.length - 1, 0);
  }

  state.trainedLine = lines.length;
  model.stats.trainedTokens = (model.stats.trainedTokens || 0) + trained;
  return { trainedTokens: trained, state };
}

function softmaxFromCounts(counts, temp) {
  const keys = Object.keys(counts || {});
  if (!keys.length) return { keys: [], probs: [] };
  const temperature = temp > 0 ? temp : 1.0;
  const logits = keys.map((k) => Math.log(counts[k] + 1) / temperature);
  let max = -Infinity;
  for (const val of logits) if (val > max) max = val;
  const exps = logits.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  const probs = exps.map((v) => v / sum);
  return { keys, probs };
}

function sampleKey(keys, probs) {
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < keys.length; i++) {
    acc += probs[i];
    if (r <= acc) return keys[i];
  }
  return keys[keys.length - 1];
}

function filterCounts(counts, bannedKeys) {
  if (!counts || !bannedKeys?.length) return counts;
  let needsFilter = false;
  for (const key of bannedKeys) {
    if (counts[key]) {
      needsFilter = true;
      break;
    }
  }
  if (!needsFilter) return counts;
  const filtered = {};
  for (const key of Object.keys(counts)) {
    if (!bannedKeys.includes(key)) filtered[key] = counts[key];
  }
  return filtered;
}

function getBackoffCounts(model, w1, w2) {
  const trigramKey = `${w1}|${w2}`;
  if (model.trigram[trigramKey]) return model.trigram[trigramKey];
  if (model.bigram[w2]) return model.bigram[w2];
  return model.unigram;
}

function getCountsForN(model, w1, w2, n) {
  if (n <= 1) return model.unigram;
  if (n === 2) return model.bigram[w2] || model.unigram;
  return getBackoffCounts(model, w1, w2);
}

function buildAddKDistribution(counts, vocabKeys, temp, addK, bannedKeys) {
  const keys = [];
  const logits = [];
  const temperature = temp > 0 ? temp : 1.0;
  for (const key of vocabKeys) {
    if (bannedKeys.includes(key)) continue;
    const weight = (counts?.[key] || 0) + addK;
    if (weight <= 0) continue;
    keys.push(key);
    logits.push(Math.log(weight) / temperature);
  }
  if (!keys.length) return { keys: [], probs: [] };
  let max = -Infinity;
  for (const val of logits) if (val > max) max = val;
  const exps = logits.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  const probs = exps.map((v) => v / sum);
  return { keys, probs };
}

function generateTokens(model, options = {}) {
  const maxTokensRaw = options.maxTokens ?? model.config.MAX_TOKENS;
  const minTokensRaw = options.minTokens ?? model.config.MIN_TOKENS ?? 0;
  const maxTokens = Number.isFinite(Number(maxTokensRaw))
    ? Math.max(1, Math.floor(Number(maxTokensRaw)))
    : DEFAULT_CONFIG.MAX_TOKENS;
  const minTokens = Number.isFinite(Number(minTokensRaw)) ? Math.max(0, Math.floor(Number(minTokensRaw))) : 0;
  const minTokensClamped = Math.min(minTokens, maxTokens);
  const temp = options.temp || model.config.TEMP;
  const nRaw = options.n ?? model.config.N ?? DEFAULT_CONFIG.N;
  const n = Math.max(1, Math.min(3, Math.floor(Number(nRaw) || DEFAULT_CONFIG.N)));
  const smoothingMode = options.smoothingMode || model.config.SMOOTHING_MODE || "backoff";
  const addKRaw = options.addK ?? model.config.ADD_K ?? DEFAULT_CONFIG.ADD_K;
  const addK = Number.isFinite(Number(addKRaw)) ? Number(addKRaw) : DEFAULT_CONFIG.ADD_K;

  const out = [];
  const bos = model.config.BOS || DEFAULT_CONFIG.BOS;
  const eos = model.config.EOS || DEFAULT_CONFIG.EOS;
  let w1 = bos;
  let w2 = bos;
  const vocabKeys = Object.keys(model.unigram || {});
  for (let i = 0; i < maxTokens; i++) {
    const banEos = out.length < minTokensClamped;
    const bannedKeys = banEos ? [bos, eos] : [bos];
    const rawCounts = getCountsForN(model, w1, w2, n) || {};

    let dist;
    if (smoothingMode === "add-k") {
      dist = buildAddKDistribution(rawCounts, vocabKeys, temp, addK, bannedKeys);
    } else {
      const counts = filterCounts(rawCounts, bannedKeys) || {};
      dist = softmaxFromCounts(counts, temp);
    }

    if (!dist.keys.length) break;
    const next = sampleKey(dist.keys, dist.probs);
    if (next === eos) break;
    out.push(next);
    w1 = w2;
    w2 = next;
  }

  return out;
}

function generateReply(model, options = {}) {
  return generateTokens(model, options).join("");
}

function ensureVocab() {
  return null;
}

module.exports = {
  DEFAULT_CONFIG,
  parseLine,
  tokenize,
  ensureModel,
  trainDiff,
  generateTokens,
  generateReply,
  ensureVocab
};
