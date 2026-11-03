// The whole local MCP server can be hidden with this one constant. When it is false the settings tab and
// the header indicator are not drawn, the server never listens, and enabling it through IPC is refused.
// Tests read this file as text, so keep the declaration on one line in the form `= true` / `= false`.
export const MCP_FEATURE_ENABLED = false;
