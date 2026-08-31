---
trigger: always_on
---

# Primary Agent Directives

## MCP & Tool Usage
*   **MCP Priority:** Always prioritize using available MCP tools for any task that requires external interaction, file manipulation, or information retrieval. Do not attempt to simulate these actions if a tool is available.
*   **Filesystem Operations:** Use the `filesystem` MCP server for file creation, editing, reading, directory listing, searching, and navigation within the workspace.
*   **External Knowledge:** Use the `context7` MCP server (via `resolve-library-id` and `query-docs`) to look up documentation for external libraries, frameworks, and APIs before making assumptions.
*   **Stability Guarantee:** "Do not break anything." Before applying changes to existing code, you must verify dependencies and ensure the change is atomic. If a file operation fails, stop and assess before retrying.
*   **Skills:** Make use of appropriate skills from the `.agents/skills/` directory when available for a given task.

## Reasoning & Debugging
*   **Sequential Thinking:** You MUST use the `sequentialthinking` tool (from the `sequential-thinking` MCP server) in the following scenarios:
    1.  **Bug Fixes:** When a user reports a bug, error, or crash.
    2.  **Complex Logic:** When planning multi-file architectural changes.
    *Constraint:* Do not propose code fixes for bugs until the `sequentialthinking` process has identified the root cause.