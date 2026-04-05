# GitHub Actions Auto-Indexer

Automatically extract and store codebase memories from every push to your main branch.

## Setup

### 1. Generate an API token

```bash
tages token generate --name "github-actions"
```

Save the token — you'll need it for the next step.

### 2. Add repository secrets

In your repo's Settings > Secrets and variables > Actions, add:

| Secret | Value |
|--------|-------|
| `TAGES_API_TOKEN` | The token from step 1 |
| `TAGES_SUPABASE_URL` | Your Supabase project URL |
| `TAGES_SUPABASE_ANON_KEY` | Your Supabase anon key |
| `TAGES_PROJECT_ID` | Your Tages project ID |

You can find the Supabase values in `~/.config/tages/projects/<slug>.json`.

### 3. Add the workflow

Copy `examples/github-actions/tages-index.yml` to `.github/workflows/tages-index.yml` in your repo:

```bash
mkdir -p .github/workflows
cp examples/github-actions/tages-index.yml .github/workflows/
```

### 4. Push and verify

Push a commit to main. The workflow will:
1. Check out the repo
2. Install the Tages CLI
3. Analyze the latest commit diff using Ollama (if available) or Claude Haiku
4. Store extracted memories in your Tages project

Check the Actions tab to verify the run succeeded, then open `tages dashboard` to see the new memories.

## Configuration

### Index depth

By default, the workflow indexes only the latest commit. To index multiple commits:

```yaml
- name: Index recent commits
  run: tages index --since "1 day" --token ${{ secrets.TAGES_API_TOKEN }}
```

### LLM provider

The indexer tries providers in order: Ollama → Claude Haiku → dumb mode (file paths only).

To use Claude Haiku in CI, add `ANTHROPIC_API_KEY` to your secrets:

```yaml
env:
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```
