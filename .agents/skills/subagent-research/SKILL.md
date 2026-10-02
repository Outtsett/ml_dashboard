---
name: subagent-research
description: >-
  Instructs the agent on how to use subagents for deep technical research across the web,
  Microsoft Learn, GitHub repositories, Stack Overflow, and API documentation.
---

# Subagent Research Workflow

When tasked with researching external documentation, attribution tools, analytical tools, or any software engineering concepts, follow this workflow to delegate the research to a subagent to prevent polluting your main conversation context.

## 1. Determine the Research Scope
Identify exactly what needs to be researched (e.g., "Find the latest API documentation for lightweight-charts v4", "Research how Microsoft Learn recommends configuring Azure MSAL in React", "Find GitHub issues related to Polars memory leaks").

## 2. Invoke the Research Subagent
Use the `invoke_subagent` tool to spawn a specialized research subagent.

```json
{
  "Subagents": [
    {
      "TypeName": "research",
      "Role": "Documentation Researcher",
      "Prompt": "Search the web for the latest lightweight-charts v4 documentation regarding price line rendering. Summarize the API methods and return the summary to me."
    }
  ]
}
```

## 3. Web and GitHub Search Strategies for Subagents
Advise the subagent in your prompt to use the following strategies:
- **Stack Overflow**: Use `search_web` with the domain parameter set to `stackoverflow.com` or include "site:stackoverflow.com" in the query.
- **GitHub Repositories**: Use `search_web` to find the repository URL, then use `read_url_content` on specific issue pages or `raw.githubusercontent.com` files to read the actual code/discussions.
- **Microsoft Learn**: Use `search_web` targeting `learn.microsoft.com` to find official architectural guidelines.

## 4. Await and Process
After invoking, simply stop calling tools and wait for the subagent to report back. Once it replies, integrate its findings into your main task (e.g., implementing the code in the ml_dashboard).
