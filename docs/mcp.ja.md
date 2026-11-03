# MCP のクライアントを Maplat Editor につなぐ

[English](mcp.md)

Maplat Editor は、小さな **MCP サーバー**（Model Context Protocol）を動かせます。Claude Code や Claude Desktop
のような LLM のクライアントから、Editor の中身を読めるようにするものです。**既定では無効**です。

## できること

- サーバーは**読み取りだけ**を行います。地図・POI・アプリを書き換えることはありません。
- 使えるツールは次のとおりです。

| ツール | 入力 | 返すもの |
|---|---|---|
| `editor.ping` | なし | `ok` と Editor の版（接続の確かめ） |
| `maps.list` | `query`（文字列・200 文字まで）・`page`（1 以上）・`pageSize`（1〜100・既定 20）。どれも省略できる | 保存した地図を 1 ページずつ: `uid`・`slug`・`title`・画像の `width` と `height`（ピクセル）・`maxZoom`（256 px のタイルの最大のズーム）と、`total`・`page`・`next` |
| `maps.get` | `map`（uid か slug） | 地図 1 枚: `title`・`width`・`height`・`maxZoom`・GCP（`[[画像上の x, y], [経度, 緯度]]` の形）・`edges`・`hasCompiled`（`maps.transform` が使えるか） |
| `maps.transform` | `map`・`direction`（`forward` か `backward`）・`points`（数 2 つの組を 1〜1000 個） | 地図の変換で点を変換した結果（地図の表示と同じ計算）。`forward` は画像のピクセル（左上が原点）から `[経度, 緯度]` へ、`backward` はその逆。画像の外の点は `null` |
| `maps.render_region` | `map`・矩形 `x0`・`y0`・`x1`・`y1`（画像のピクセル。`x0 < x1`・`y0 < y1`・画像の中）。省略できるもの: `scale`（1〜4・既定 2）・`grid_step`（画像のピクセル）・`marks`（`{ x, y, label }` を 50 個まで。label は ASCII で 8 文字まで）・`format`（`png` か `jpeg`・既定 `png`） | 地図の画像のその部分を、保存したタイルから描いた画像（最大 1024 × 1024 ピクセル）。`grid_step` を付けるとその倍数の位置に座標つきの線（`grid_step` × `scale` は 32 以上）、`marks` で赤い十字。`structuredContent` に `origin`・`scale`・`width`・`height`・使ったタイルの `zoom`。出力のピクセル (u, v) は画像のピクセル (x0 + u / scale, y0 + v / scale) |

- サムネイルとタイル 1 枚を読むツールと、範囲で探すツールは、次の版から足します。

## 有効にする

1. **設定**を開き、**MCP サーバー**のタブを選びます。
2. **MCP サーバーを有効にする**をオンにします。送られる可能性のあるものを説明する確認が出るので、**有効にする**を選びます。
3. 待ち受けている間は、上の帯の右端に `MCP 127.0.0.1:<ポート>` が出ます。

既定のポートは **41871** です。同じタブで変えられます（1024〜65535 の整数）。

有効にする前に知っておいてほしいこと: 地図の画像・GCP・POI が、接続した LLM のクライアントへ渡り、その提供元の
サービスへ送られることがあります。

## クライアントに登録する

URL は `localhost` ではなく **`127.0.0.1`** で登録してください。`127.0.0.1` は、コンピューターの名前の解決のしかたに左右されません。

### Claude Code

**Claude Code の登録コマンドをコピー**を押し、端末に貼り付けて実行します。次の形です。

```sh
claude mcp add --transport http maplat-editor http://127.0.0.1:41871/mcp --header "Authorization: Bearer <トークン>"
```

`claude mcp get maplat-editor` で確かめられます（Editor が待ち受けている間は *Connected* と出ます）。

### Claude Desktop（mcp-remote 経由）

Claude Desktop は、手元の HTTP のサーバーに [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) を通してつなぎます。
`mcp-remote` は第三者の npm パッケージです（版 0.16.0 で確かめました）。Node.js が必要です。
**Maplat Editor は `mcp-remote` の安全を保証しません**。信頼できる場合だけ入れてください。

**Claude Desktop（mcp-remote）の設定をコピー**を押し、コピーした JSON を Claude Desktop の
`claude_desktop_config.json` に合わせて書き込みます。次の形です。

```json
{
  "mcpServers": {
    "maplat-editor": {
      "command": "npx",
      "args": ["mcp-remote", "http://127.0.0.1:41871/mcp", "--transport", "http-only", "--header", "Authorization:${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer <トークン>" }
    }
  }
}
```

ヘッダを `env` から渡すのは、`args` の中の空白を正しく扱わないクライアントがあるためです。

## コピーしたコマンドについて

- コピーの前には必ず確認が出ます。
- コピーした文にはトークンが含まれます。Editor は **1 分後**に、クリップボードの中身がまだその文のままなら消します。
  Editor を終えたときも同じように消します。
- クリップボードの履歴（Windows の Win+V や、macOS のクリップボード管理アプリなど）や同期（Universal Clipboard など）を
  使っている場合は、そちらに写しが残ります。使っている場合は、そちらで消してください。
- 画面にトークンの全体は出ません。末尾の 4 文字だけです。

## サーバーの守り

- 待ち受けるのは `127.0.0.1`（このコンピューターの中）だけです。ほかのコンピューターからはつながりません。
- Web ページからの要求（`Origin` ヘッダが付く）は断ります。`Host` ヘッダも `127.0.0.1:<ポート>` か
  `localhost:<ポート>` そのものでなければ断ります。開いた Web ページからはサーバーを使えません。
- すべての要求にトークン（`Authorization: Bearer <トークン>`）が要ります。間違ったトークンが続くと、次の試みを遅らせます。
- 要求の大きさ・同時の数・時間に上限があります。

### 守れないこと

- **トークンは、クライアントの設定に平文で残ります**（Claude Code の設定や `claude_desktop_config.json`）。ファイルを
  読める人は読めます。コンピューターのアカウントを他人と共有している場合は、MCP を使い終えたら再発行してください。
- **Claude Code の登録コマンドを端末で実行すると、トークンがシェルの履歴に残ります**（`~/.zsh_history` や
  PowerShell の履歴など）。気になる場合は、履歴からその行を消すか、登録の後に**再発行**して登録し直してください。
- **同じアカウントで動くプログラムは、Editor の設定のファイルからトークンを読めます**。サーバーはこれを防げません。
- **Editor が待ち受けていない間**（無効のときや起動していないとき）は、同じコンピューターの別のプログラムが同じ
  ポートを開き、クライアントが送るトークンを受け取れます。Editor は起動したときにポートが使われていると、MCP のタブに
  「別のプログラムが同じポートを使っています…」を出します。これを見たら、そのプログラムを閉じて**再発行**を押し、
  新しいコマンドをクライアントに登録し直してください。

## トークンを再発行する

MCP のタブで**再発行**を押します。古いトークンはすぐに使えなくなります。コマンドをコピーし直して、クライアントの
登録を更新してください。

## 無効にする

スイッチをオフにします。ポートはすぐに閉じます。Editor を終えたときも止まります。macOS で窓を閉じても
（アプリは動き続けます）止まりません。
