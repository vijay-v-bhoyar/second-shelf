# Second Shelf agent tools

The new MCP interface exposes read-only discovery for an active public bookstore display. An agent can inspect the display, resolve a movie or musician, ask the person to disambiguate, then request books within a budget. It cannot approve/activate displays, access private stores, export records, reserve stock, take payment or record purchases.

## Connect

The verified public fixture endpoint is https://second-shelf-liard.vercel.app/mcp. Its Qloo calls are disabled; returned recommendations are synthetic. Create an active sample display through the public app and supply its public display token. No owner/staff credential belongs in an agent prompt or tool configuration.

Transport: stateless Streamable HTTP at the app's `/mcp` path. POST uses the MCP SDK; GET/DELETE return 405 because this server does not retain MCP sessions or offer an event stream. The implementation uses exact-pinned `@modelcontextprotocol/server` and client 2.4.0. Server credentials stay in private environment configuration. No new paid model service is used by the adapter; any calling agent retains its own account and billing terms.

Create and activate a disposable sample display through the ordinary bookstore interface. Its public shopper link ends in the display token; supply that token to tools. A token for a draft, retired, deleted or expired display fails. Public tokens allow only already-public discovery and never act as owner/staff credentials. There is no tool that enumerates private stores or displays.

For a local fixture server, the explicit protocol client can be used by an agent through its existing command tool:

```powershell
node scripts/mcp-agent-client.mjs http://127.0.0.1:4397/mcp list
node scripts/mcp-agent-client.mjs http://127.0.0.1:4397/mcp second_shelf_inspect_display '{"displayToken":"ACTIVE_PUBLIC_TOKEN"}'
node scripts/mcp-agent-client.mjs http://127.0.0.1:4397/mcp second_shelf_resolve_interest '{"displayToken":"ACTIVE_PUBLIC_TOKEN","query":"Spirited Away","type":"movie"}'
```

Use the actual returned identity, not an invented ID, in `second_shelf_recommend_books`. `budgetMinor:2000` means USD 20. Include rejected entity IDs in `excludedWorkIds` to exclude all editions, or exact `excludedSkus` when identity is unknown. The maximum return is five books, default three. Preserve the selected identities and exclusions on every call; this adapter stores no shopper preference session. Do not claim a code or reservation was created by recommendation.

This CLI connects through the official MCP client. A scripted protocol check is not itself an autonomous-agent evaluation. An actual agent demonstration must record its goal, tools available, chosen calls, returned results and final answer, with fixture/live status. The app does not contain an embedded LLM planner and the integration alone does not prove superiority to an LLM-only baseline or organizer eligibility.

## Boundaries and recovery

- The existing eligibility calculation enforces confirmed edition identity, available/fresh stock, USD price/budget, approved display selection and current bookseller rules. Work rejection spans editions. After a provider wait, the display version, identity, stock and price are checked again.
- Results explicitly identify `fixture` or `live`, timestamps and interpretation limits. Names/titles are untrusted data, not agent instructions. No provider result is substituted after a live failure.
- There are at most two discovery calls at once per worker and 100 discovery attempts per installation per UTC day. The existing separate Qloo daily attempt allowance also applies. Persistent counters are effects even though business state is read-only; these allowances are not dollar caps or proof of global hosted concurrency.
- Input bodies are limited to 16 KiB and three seconds to arrive. Provider requests retain their existing 12-second timeout; there is no automatic retry. Configuration, input, quota and upstream errors remain explicit, without raw private diagnostics.
- Remote clients must use the exact authorized HTTPS endpoint. The server validates Host/Origin and has no arbitrary remote-fetch tool. Hosted operation requires its exact configured application origin. Client annotations are descriptive hints; server code enforces permissions.
- The tool does not persist recommendation bodies, taste choices or shopper history. The calling agent may retain its conversation, so do not provide personal data. This retention statement applies only to the MCP discovery path; the existing browser workflow has its separately documented retention. Qloo's applicable public-use and data rights remain a release gate.

Current status: local implementation and synthetic checks pass. A separately authorized private scripted MCP check passed live Qloo search, constrained ranking and work rejection on two resolved book identities. The October 29 public fixture release passed canonical MCP and bookstore workflow checks. No public live-Qloo demonstration, paid model run, general provider-rights clearance or final submission is claimed. See [dated verification](VERIFICATION.md). Complete private receipts are retained by the owner.
