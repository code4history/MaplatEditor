# Connecting MCP clients to Maplat Editor

[日本語](mcp.ja.md)

Maplat Editor can run a small **MCP server** (Model Context Protocol) so that an LLM client such as
Claude Code or Claude Desktop can read from the editor. It is **off by default**.

## What it can do

- The server only **reads**. It never changes your maps, POIs or apps.
- It offers these tools:

| Tool | Input | What it gives |
|---|---|---|
| `editor.ping` | none | `ok` and the editor version (checks the connection) |
| `maps.list` | `query` (text, up to 200 characters), `page` (1 or more), `pageSize` (1 to 100, default 20), all optional | The saved maps a page at a time: `uid`, `slug`, `title`, image `width` and `height` in pixels, `maxZoom` (the largest zoom level of the map's 256 px tiles), plus `total`, `page` and `next` |
| `maps.get` | `map` (uid or slug) | One map: `title`, `width`, `height`, `maxZoom`, the GCPs as `[[x, y] on the image, [longitude, latitude]]`, the `edges`, and `hasCompiled` (whether `maps.transform` works for it) |
| `maps.transform` | `map`, `direction` (`forward` or `backward`), `points` (1 to 1000 pairs of numbers) | The points converted with the map's transformation, as the map viewer does: `forward` from image pixels (origin at the top left) to `[longitude, latitude]`, `backward` the other way. A point off the image is `null` |
| `maps.render_region` | `map`, the rectangle `x0`, `y0`, `x1`, `y1` (image pixels, `x0 < x1`, `y0 < y1`, inside the image), optional `scale` (1 to 4, default 2), `grid_step` (image pixels), `marks` (up to 50 `{ x, y, label }`, label up to 8 ASCII characters), `format` (`png` or `jpeg`, default `png`) | A picture of that part of the map image, drawn from its saved tiles, at most 1024 x 1024 pixels. `grid_step` adds labelled lines on its multiples (`grid_step` x `scale` at least 32), `marks` adds red crosses. `structuredContent` gives `origin`, `scale`, `width`, `height`, the tile `zoom` and `missingTiles` (tiles that could not be drawn). Each image pixel is a `scale` x `scale` square: output pixel (u, v) is image pixel (x0 + floor(u / scale), y0 + floor(v / scale)) |

- Tools that read thumbnails and single tiles, and that search by area, are added in later versions.

## Turning it on

1. Open **Settings** and choose the **MCP server** tab.
2. Turn on **Turn on the MCP server**. A dialog explains what may be sent; choose **Turn on** to continue.
3. While the server is listening, the top bar shows `MCP 127.0.0.1:<port>` at its right end.

The default port is **41871**. You can change it on the same tab (a whole number from 1024 to 65535).

What you should know before turning it on: map images, GCPs and POIs may be passed to the connected LLM client
and sent to the service that provides it.

## Registering the server in a client

Use the URL with **`127.0.0.1`**, not `localhost`. `127.0.0.1` does not depend on how your computer resolves names.

### Claude Code

Press **Copy the Claude Code registration command** and paste it into a terminal. It has this form:

```sh
claude mcp add --transport http maplat-editor http://127.0.0.1:41871/mcp --header "Authorization: Bearer <token>"
```

Check it with `claude mcp get maplat-editor` (it should say *Connected* while the editor is listening).

### Claude Desktop (through mcp-remote)

Claude Desktop reaches local HTTP servers through [`mcp-remote`](https://www.npmjs.com/package/mcp-remote), a
third-party npm package (checked with version 0.16.0). It needs Node.js. **Maplat Editor does not vouch for the
safety of `mcp-remote`**; install it only if you trust it.

Press **Copy the Claude Desktop (mcp-remote) setting** and merge the copied JSON into Claude Desktop's
`claude_desktop_config.json`. It has this form:

```json
{
  "mcpServers": {
    "maplat-editor": {
      "command": "npx",
      "args": ["mcp-remote", "http://127.0.0.1:41871/mcp", "--transport", "http-only", "--header", "Authorization:${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer <token>" }
    }
  }
}
```

The header is passed through `env` because some clients do not escape spaces inside `args`.

## About the copied command

- Copying always asks for confirmation first.
- The copied text contains the token. The editor removes it from the clipboard after **one minute** if the
  clipboard still holds it, and also when the editor quits.
- A clipboard history (for example Windows' Win+V, or a clipboard manager on macOS) or clipboard sync (for example
  Universal Clipboard) keeps its own copy. Clear it there yourself if you use one.
- The screen never shows the whole token, only its last four characters.

## How the server protects itself

- It listens only on `127.0.0.1` (this computer). Other computers cannot connect.
- Requests that come from a web page (they carry an `Origin` header) are refused, and the `Host` header must be
  exactly `127.0.0.1:<port>` or `localhost:<port>`. A web page you visit cannot use the server.
- Every request needs the token (`Authorization: Bearer <token>`). Wrong tokens slow down further attempts.
- Requests are limited in size, number at the same time, and time.

### Limits you should know

- **The token is stored in plain text in your client's settings** (Claude Code's configuration, or
  `claude_desktop_config.json`). Anyone who can read your files can read it. If other people use your computer
  account, regenerate the token when you stop using MCP.
- **Running the Claude Code command in a terminal leaves the token in your shell history** (for example
  `~/.zsh_history` or PowerShell's history). If that worries you, delete that line from the history or press
  **Regenerate** afterwards and register again.
- **Programs running under your own account can read the token** from the editor's settings file. The server cannot
  protect against them.
- **While the editor is not listening** (turned off or not running), another program on the same computer can open
  the same port and receive the token your client sends. When the editor starts and finds the port already in use,
  the MCP tab shows *"Another program is using the same port…"*. If you see it, close that program and press
  **Regenerate**, then register the new command in your client again.

## Regenerating the token

Press **Regenerate** on the MCP tab. The old token stops working at once; copy the command again and update your
client.

## Turning it off

Turn the switch off. The port is closed at once. The server also stops when the editor quits. On macOS, closing the
window (the app keeps running) does not stop it.
