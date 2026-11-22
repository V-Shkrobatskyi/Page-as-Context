# Page as Context tutorials

Learn how to prepare structured page context for AI, choose what to share, and connect a compatible desktop AI application when needed. Start with the first tutorial; ordinary capture and export do not require MCP setup or an extension account.

These tutorials describe version **2.2.8**. Tutorials 1–3 include screenshots captured with version 2.2.7 in Chrome; tutorial 1 also shows an AI conversation. Tutorial 4 compares popup results for the four compression profiles. Tutorial 5 shows release assets and native helper/HFS settings. Tutorial 6 shows Claude Desktop reading and editing a synthetic GitHub issue draft in Chrome. Tutorial 7 shows a local Chrome/macOS policy pilot. These examples do not establish benchmark results or verification of GPO/MDM rollout. For installation links, see the [project README](../../README.md).

## Start here

| Step | Tutorial | What you will do |
| --- | --- | --- |
| 1 | [Your first web page context](first-page-context.md) | Capture a page, review its context and ask AI a focused question, using a public GitHub repository as an example |
| 2 | [Select, edit and export](select-edit-export.md) | Choose a relevant block, edit the prepared text and copy or save it |
| 3 | [Custom privacy filters](custom-filters.md) | Add rules for your own terms, test them and prepare a fresh capture |
| 4 | [Compression profiles](compression.md) | Compare four profiles using the copy results displayed in the popup |

Desktop browsers support the complete manual workflow. Firefox Android supports whole-page and selected-element capture, preview/edit and copying; file saving is unavailable there. Organization policies may restrict features or make previews read-only.

## Connect AI or manage a team setup

| Step | Tutorial | Use it when |
| --- | --- | --- |
| 5 | [Browsers, AI clients and platforms](browsers-clients-platforms.md) | You want to choose between manual export, a native package and Local HTTP |
| 6 | [MCP Read and Write](mcp-read-write.md) | You want to pair a desktop AI client and explicitly share a test tab |
| 7 | [Managed-browser policy pilot](enterprise-policies.md) | You administer browsers and want to test a small required-policy configuration |

The supplied native AI-app packages target macOS Apple Silicon. Local HTTP/HFS is a separate route for compatible local clients; macOS Apple Silicon and Windows 10 x64 reads/actions have been tested, while Linux startup remains unverified. See the [connection guide](browsers-clients-platforms.md) for the distinction between available setup routes and verified environments.

## Keep the shared context under your control

Start with a public page or synthetic data. Filters are heuristic: review manual exports before sharing and configure data controls before granting MCP access. The AI application may send received context to its model provider, even when capture and the browser connection are local. Follow your organization's data-sharing rules.

For detailed behavior and troubleshooting, see [capture and export](../capture-and-export.md), [data controls](../data-controls-and-diagnostics.md), [MCP setup](../mcp-integration.md), [Local HTTP](../hfs-integration.md) and [enterprise deployment](../enterprise-deployment.md).
