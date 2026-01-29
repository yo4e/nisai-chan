# 2さいちゃん 設計書（トライグラム＋平滑化 n-gram LM）

目的：

* 1さいちゃん（単語ビグラム・カウント方式）を土台に、**単語トライグラム**と**平滑化（Backoff/簡易Add-k）**を導入して「文脈が伸びると、それっぽさが増える」「未出の組み合わせにも逃げ道ができる」を体験的に観察する。
* 賢さの追求ではなく、**観察可能でシンプル**な実装を優先する。

---

## 0. 前提・スコープ

### 前提

* 既存構成（1さいちゃん）を複製（Forkまたはコピー）して2さいちゃんを作る。
* 学習データは `data/chat.txt`（会話ログ）を継続利用。
* 学習対象は **ユーザー発話（U行）**のみ（1さいちゃんの仕様を継承）。
* トークナイズは 1さいちゃんと同じ方式（比較のため）。

### 対象ファイル

* `server/lm.js`：学習と生成のコア（主改修）
* `server/io.js`：モデルの保存/読込（必要なら拡張）
* `data/model.json`：カウントモデル（フォーマット拡張）
* `web/`：UIは基本流用（表示文言の更新程度）

---

## 1. フォルダ構成（継承）

```
nisai-chan/
  data/
    chat.txt
    vocab.json      # （任意）デバッグ表示用に使える
    model.json      # trigram/bigram/unigram カウント
    state.json      # 学習済み行番号
  server/
    server.js
    lm.js
    io.js
  web/
    index.html
    app.js
    style.css
```

---

## 2. データ仕様

### 2.1 トークン

* 1さいちゃんと同じ「単語」単位。
* 生成安定のため、文頭/文末トークンを導入：

  * `N = 3`（trigram）
  * `BOS = "<BOS>"` を **N-1 個**
  * `EOS = "<EOS>"`

例：

* 原文：`"朝 は おはよう 。"`
* tokens：`[<BOS>, <BOS>, 朝, は, おはよう, 。, <EOS>]`（N=3 の場合）

### 2.2 学習対象

* `chat.txt`のうち、ユーザー行（U行）のみ。
* 1さいちゃんと同じ終了ルール（例：最大語数、またはEOSまで）を継承。

---

## 3. モデル仕様（カウント）

### 3.1 目的

* trigram（前2語）を主に使い、未出なら bigram、さらに未出なら unigram に**後退（Backoff）**する。
* これにより「未出の組み合わせが確率0で詰まる」状態を回避する。

### 3.2 `data/model.json` フォーマット

キー設計：

* trigram のコンテキストは `"w1|w2"` で連結（簡単・読みやすい）。

推奨フォーマット：

```json
{
  "meta": {
    "version": "2saichan-1",
    "tokenizer": "same-as-issai",
    "smoothing": "backoff",
    "bos": "<BOS>",
    "eos": "<EOS>"
  },
  "unigram": {
    "<EOS>": 120,
    "こんにちは": 12
  },
  "bigram": {
    "<BOS>": {"こんにちは": 3},
    "こんにちは": {"。": 5, "<EOS>": 2}
  },
  "trigram": {
    "<BOS>|<BOS>": {"こんにちは": 3},
    "朝|は": {"おはよう": 2, "こんにちは": 1}
  }
}
```

メモ：

* `unigram`は fallback として必須。
* `bigram`は trigram未出のときに使用。
* `trigram`が2さいちゃんの主役。

---

## 4. 学習（トレーニング）仕様

### 4.1 入力

* `chat.txt` の未学習部分（`state.json` の行番号から続き）を読む。

### 4.2 処理手順

1. 対象行（U行）の本文を抽出
2. 1さいちゃんと同じ tokenizer で単語列にする
3. `tokens = [BOS x (N-1)] + tokens + [EOS]`
4. unigram/bigram/trigram を同時にカウント

疑似コード：

* unigram：`unigram[t[i]]++`
* bigram：`bigram[t[i-1]][t[i]]++`（i>=1）
* trigram：`trigram[t[i-2]+'|'+t[i-1]][t[i]]++`（i>=2）

### 4.3 状態更新

* 学習した最終行番号を `state.json` に保存。
* 途中で失敗しても壊れにくいよう、

  * 先にメモリ上で集計 → まとめて保存
  * あるいはテンポラリに書いて置き換え

---

## 5. 生成（サンプリング）仕様

### 5.1 基本

* 直前2語をコンテキストとして次語をサンプル。
* 最大長（例：20語）で打ち切り。
* `EOS`が出たら終了。
* `MIN_TOKENS` に達するまでは `EOS` を候補から除外。
* `BOS` は生成中の候補から除外（文頭専用）。

### 5.2 平滑化（推奨：Backoff）

優先順位：

1. trigram 分布が存在 → trigramからサンプル
2. なければ bigram（直前1語）
3. なければ unigram
4. それも無理なら `EOS`

疑似コード：

```
ctx2 = w_{n-2} + '|' + w_{n-1}
if trigram[ctx2] exists:
  dist = trigram[ctx2]
else if bigram[w_{n-1}] exists:
  dist = bigram[w_{n-1}]
else:
  dist = unigram
return sample(dist)
```

### 5.3 代替平滑化（任意：Add-k）

* 実験用オプションとして残せる。
* ただし比較の観点では Backoff のほうが「成長感」が観察しやすい。

---

## 6. API（server.js）

既存のエンドポイントを踏襲：

* `POST /api/reply`

  * 入力：ユーザーの発話 + 生成オプション
  * 出力：2さいちゃんの返答

処理フロー：

1. ユーザー発話を `chat.txt` に追記
2. 必要なら `lm.learnIncremental()` を走らせる（U行のみ）
3. `lm.generateTokens()` を実行 → joiner で整形
4. 返答を `chat.txt` に追記
5. UIへ返す

---

## 7. UI（web/）

### 7.1 基本

* UIは基本流用。
* 表示名：

  * タイトル：`2さいちゃん`
  * サブ：`超ミニLM / ローカル学習（trigram + smoothing）`

### 7.2 パラメータ変更UI（プルダウン／入力欄）

観察学習をしやすくするため、**生成パラメータをUIから変更可能にする**。
すべて「挙動の違いを観察するための実験つまみ」という位置づけ。

#### (1) 最小語数 `MIN_TOKENS`

* 入力方式：数値入力（例：1〜10）
* 役割：この語数に達するまで `<EOS>` を生成候補から除外
* 初期値：`2`

#### (2) 最大語数 `MAX_TOKENS`

* 入力方式：数値入力（例：5〜50）
* 役割：無限ループ防止・発話の長さ制御
* 初期値：`20`

#### (3) 平滑化方式 `SMOOTHING_MODE`

* 入力方式：プルダウン
* 選択肢：

  * `backoff`（デフォルト・推奨）
  * `add-k`（実験用）
* 役割：trigram未出時の逃げ方の違いを観察

#### (4) Add-k の k 値（add-k選択時のみ有効）

* 入力方式：数値入力（小数可）
* 初期値：`0.1`
* 備考：UIでは非表示でもよいが、将来の観察用に拡張余地あり

#### (5) 表示用トークン連結方式

* 入力方式：プルダウン
* 選択肢：

  * `no-space`（デフォルト：日本語表示用）
  * `space`（デバッグ観察用）
* 備考：内部処理は常にトークン配列。表示だけ切替。

---

### 7.3 実装方針

* これらのUI設定は `app.js` から `/api/reply` に送信するリクエストボディへ含める
* サーバー側ではデフォルト値を持ち、未指定時は既定値を使用
* モデル本体（`lm.js`）は、設定オブジェクトを引数として受け取る形にする

  ```js
  generateTokens({ maxTokens, minTokens, smoothingMode, addK })
  ```

server 側で `tokens.join(joiner)` を実行して返答文字列に整形する。

これにより、**同じモデルでも設定を変えるだけで性格が変わる様子を観察できる**。

---

### 7.4 デバッグ表示（任意）

* UIは基本流用。
* 表示名：

  * タイトル：`2さいちゃん`
  * サブ：`超ミニLM / ローカル学習（trigram + smoothing）`

デバッグ表示（任意）：

* `?debug=1` のとき、

  * unigram/bigram/trigram の語彙数
  * 直近コンテキストと選ばれた分布種別（tri/bi/uni） を表示できると観察が捗る。

---

## 8. 観察ポイント（学習目的）

1. **文脈が伸びると、それっぽさが増す**

   * 「前2語」の制約で次語が安定しやすい
2. **未出の組み合わせで詰まらない**

   * Backoff によって確率0問題が緩和
3. **データが性格になる**

   * U行だけ学習なので、ユーザーの癖がそのまま“人格”になる

---

## 9. テスト観点（最低限）

* 学習：

  * `state.json` が進む
  * `model.json` に trigram が増える
* 生成：

  * すぐ終了しすぎない／無限ループしない
  * trigram がある場面では trigram が優先される（debugで確認）
* 互換：

  * 1さいちゃんとトークナイズが同一（比較可能）

---

## 10. 実装メモ（アンチグラビティ用指示の骨子）

* `server/lm.js` に以下を実装：

  * `learnFromChat(chatText, state)`（U行のみ）
  * `updateCounts(tokens)`（uni/bi/tri 同時）
  * `nextWord(ctx2, last1)`（Backoff）
  * `generateTokens(opts)`（EOSで停止、minTokensまでEOS除外）
* `server/io.js`：

  * `loadModel()` / `saveModel()` のフォーマット拡張
* `data/model.json`：

  * `meta` と `unigram/bigram/trigram` を持つ

---

## 付録：推奨パラメータ

* `MAX_TOKENS = 20`
* `BOS = <BOS>`（2個）
* `EOS = <EOS>`
* サンプリング：

  * 重み付きランダム（累積和で選択）

---

（以上）
