# Migration Guide: TypeScript to Go

## Architecture Mapping

The TypeScript server tools map to the Go server structure as follows:

| TypeScript Tool | Go Fork Status | Implementation Details |
|-----------------|----------------|------------------------|
| `create_project` | ✅ Implemented | Uses GraphQL `createProjectV2` mutation. |
| `create_iteration_field` | ✅ Implemented | Uses GraphQL `createProjectV2Field` and `updateProjectV2Field` mutations. |
| `update_item_status` | ✅ Ported | Ported as `update_project_item_status`. Resolves status names to option IDs via GraphQL. |
| `create_milestone` | ✅ Ported | Ported to `pkg/github/issues.go`. Uses standard REST API. |
| `add_subissue` | ✅ (Official) | Built-in as `sub_issue_write` (method: add). |
| `remove_subissue` | ✅ (Official) | Built-in as `sub_issue_write` (method: remove). |
| `reprioritize_subissue` | ✅ (Official) | Built-in as `sub_issue_write` (method: reprioritize). |
| `create_project_status_update` | ✅ Ported | Ported to `pkg/github/projects.go`. Uses GraphQL `createProjectV2StatusUpdate` mutation. |
| `get_project_status_updates` | ✅ Ported | Ported to `pkg/github/projects.go`. Uses GraphQL query on `ProjectV2.statusUpdates`. |
| `update_project_settings` | ✅ Ported | Ported to `pkg/github/projects.go`. Uses GraphQL `updateProjectV2` mutation. |

## POC: Ported Tools

The following tools have been ported to the Go fork (`github-mcp-server`) to align with official patterns:
- `update_project_item_status`: Integrated with `ToolsetMetadataProjects`.
- `create_milestone`: Integrated with `ToolsetMetadataIssues`.
- `create_project_status_update`: Integrated with `ToolsetMetadataProjects`.
- `get_project_status_updates`: Integrated with `ToolsetMetadataProjects`.
- `update_project_settings`: Integrated with `ToolsetMetadataProjects`.

## Recommendations

1. **Architecture Alignment**: The Go server's modular structure (`pkg/github`) is ideal for categorizing tools. Standardizing on `MinimalResponse` or specialized result maps maintains consistency.
2. **Consolidated vs. Standalone**: The fork currently mixes consolidated tools (like `projects_write`) with standalone ones. For official alignment, consider if these new tools should eventually be merged into the consolidated methods or kept separate for developer experience.
3. **Distribution**: Extending the Go fork is the best path forward. It leverages the existing official architecture while providing enhanced Project V2 features.