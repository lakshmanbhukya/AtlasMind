---
trigger: always_on
---

Always use MCP's tools to related works and perform sequentialthinking when needed and do not break anything and make use of appropriate skills for tasks from the .agents/skills directory# Primary Agent Directives

## MCP & Tool Usage
*   **MCP Priority:** Always prioritize using available MCP tools for any task that requires external interaction, file manipulation, or information retrieval. Do not attempt to simulate these actions if a tool is available.
*   **Filesystem Operations:** STRICTLY use the `filesystem` MCP for all file creation, editing, and reading operations.
*   **Stability Guarantee:** "Do not break anything." Before applying changes to existing code, you must verify dependencies and ensure the change is atomic. If a file operation fails, stop and assess before retrying.

## Reasoning & Debugging
*   **Sequential Thinking:** You MUST use the `sequentialthinking` tool in the following scenarios:
    1.  **Bug Fixes:** When a user reports a bug, error, or crash.
    2.  **Complex Logic:** When planning multi-file architectural changes.
    *Constraint:* Do not propose code fixes for bugs until the `sequentialthinking` process has identified the root cause.

## Knowledge & Skills
*   **Skill Usage:** Before writing custom scripts or logic, ALWAYS check the `.agents/skills` directory. If a relevant skill exists, invoke it instead of reinventing the workflow.
*   **Documentation (Context7):** Use the `context7` MCP to retrieve updated documentation and external knowledge. Do not rely on outdated internal training data for libraries or frameworks.

## UI & Frontend
*   **Shadcn Component:** Use the `shadcn` MCP exclusively for generating, modifying, or managing UI components. Ensure all new UI elements follow the existing project's design tokens and structure.
