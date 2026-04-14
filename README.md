# GrubHub Payments API

This repo was scaffolded from a Postman API Builder export and is designed around one service per repo and one dedicated Postman workspace.

## What Lives Here

- `specs/grubhub-payments-api.yaml` is the Git source of truth for the service contract.
- `api-manifest.json` defines the repo metadata, runtime URLs, and Postman naming.
- `.postman/resources.yaml` starts with the local spec reference and is updated with Postman cloud resource ids after onboarding runs.
- `.github/workflows/onboard-to-postman.yml` serves the checked-in spec on a temporary local HTTPS endpoint, then calls `postman-cs/postman-api-onboarding-action@v0`, which chains `postman-cs/postman-bootstrap-action` and `postman-cs/postman-repo-sync-action`.
- The onboarding workflow also seeds repo variables with the resolved workspace, spec, collection, mock, and monitor ids so later reruns stay pinned to the same Postman assets.
- The onboarding workflow is serialized per repo and reuses committed `.postman/resources.yaml` environment ids so overlapping reruns do not create duplicate workspace assets.
- The onboarding workflow explicitly uses Bifrost for workspace-to-repo linking, auto-discovers system environment ids from the team when needed, and fails if the workspace never reaches API Catalog linking through that path.
- `postman/` is populated by the shared onboarding action with exported Postman artifacts for this service.

## Required Secrets

- `POSTMAN_API_KEY`
- `POSTMAN_ACCESS_TOKEN` for Bifrost repo linking, governance, and other internal Postman integrations
- `GH_FALLBACK_TOKEN` when you want a stronger fallback token for repo writes than the default GitHub Actions token

## Optional Repo Overrides

- `POSTMAN_WORKSPACE_ID` can pin an existing workspace instead of creating one by name.
- `POSTMAN_SPEC_ID`, `POSTMAN_BASELINE_COLLECTION_ID`, `POSTMAN_SMOKE_COLLECTION_ID`, and `POSTMAN_CONTRACT_COLLECTION_ID` can seed an existing Postman asset set.
- `POSTMAN_ENVIRONMENT_UIDS_JSON` can pin existing Postman environment UIDs when you want reruns to reuse explicit environment records immediately.
- `POSTMAN_MONITOR_ID` and `POSTMAN_MOCK_URL` can pin the existing smoke monitor and mock server instead of creating new ones.
- `POSTMAN_COLLECTION_SYNC_MODE` defaults to `reuse` so reruns stay on one baseline/smoke/contract set. Set it to `refresh` or `version` only when you intentionally want regenerated assets.
- `POSTMAN_SPEC_SYNC_MODE` defaults to `update` and can be changed to `version` for release-scoped specs.
- `POSTMAN_GOVERNANCE_MAPPING_JSON` can override the domain-to-governance-group mapping used during bootstrap.
- `POSTMAN_SYSTEM_ENV_MAP_JSON` can override the discovered system environment id map when you do not want to rely on Bifrost discovery.
- `POSTMAN_REQUESTER_EMAIL`, `POSTMAN_WORKSPACE_ADMIN_USER_IDS`, `POSTMAN_TEAM_ID`, `POSTMAN_WORKSPACE_TEAM_ID`, and `POSTMAN_ORG_MODE` support workspace membership and org-mode tenant behavior.
- `POSTMAN_REQUIRE_API_CATALOG_LINK` defaults to `true`. Leave it there if you want the workflow to fail whenever Bifrost workspace linking is skipped or fails.
- `POSTMAN_REQUIRE_SYSTEM_ENV_ASSOCIATION` defaults to `true`. Leave it there if you want the workflow to fail whenever Bifrost cannot resolve or associate the requested runtime environments.
- `POSTMAN_INTEGRATION_BACKEND` defaults to `bifrost` and should only be changed when the shared action suite supports another public backend.
- `POSTMAN_REPO_WRITE_MODE` can be set to `commit-only` or `none` when you do not want the shared action to push generated Postman metadata back into the repo.
- `POSTMAN_MONITOR_CRON` can enable the shared action's smoke monitor creation.

## Collections

- The shared onboarding action maintains baseline, smoke, and contract collections for this service.
- `.postman/resources.yaml` and the `postman/` directory become the durable repo-side record of those assets after the first successful onboarding run.

## Default Workspace

The onboarding workflow will reuse or create this workspace:

- `[GH] GrubHub Payments API`

## Repo Source

- `shivemind/grubhub-payments-api`
