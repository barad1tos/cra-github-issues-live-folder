<a href="https://crabrowser.app/">
  <img src="https://raw.githubusercontent.com/VictorKildahl/cra/3b96bad2d0735963d9701c4035d2136e453cc197/brand/cra-segments.svg" width="88" alt="Cra browser mark">
</a>

# GitHub Issues Live Folder for Cra

See open issues from the GitHub repositories you own in Cra's sidebar. Issues appear whether they are assigned to you, assigned to someone else, or unassigned.

[Install the plugin](#install) · [Get Cra](https://crabrowser.app/) · [Cra on GitHub](https://github.com/VictorKildahl/cra)

This community plugin adds a GitHub Issues Live Folder to Cra, the open-source macOS browser by Victor Kildahl. GitHub resolves `@me` from the session in the folder's Space. Private repositories appear when that session has access and GitHub returns them in search.

## Install

1. Sign in to GitHub and open the latest successful [CI run on `main`](https://github.com/barad1tos/cra-github-issues-live-folder/actions/workflows/ci.yml?query=branch%3Amain). Download `cra-github-issues-plugin.zip` under **Artifacts**.
2. In Cra, open **Settings → Plugins → Add Plugin…** and select the ZIP. On versions that list **Live folder plugins** in **Settings → Extensions**, use **Add Plugin…** there.
3. In the Space where you use GitHub, run **New GitHub Issues Live Folder** from Cra's command bar. Sign in to GitHub in that Space if prompted.

The folder uses GitHub's web issue search. If GitHub limits or interrupts pagination, the folder keeps its previous results and shows a refresh error.

## Build and test

Use Node.js 26 with `zip` and `unzip` installed.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run package
```

The build compiles [`plugin/main.ts`](plugin/main.ts) and writes `cra-github-issues-plugin.zip` in the repository root. Tests exercise the packaged entry with simulated GitHub search pages.

Run the CI lint checks with `prek run --all-files --hook-stage manual` after installing `prek` and `uv`. If your clone uses Git's default hook directory, run `prek install --hook-type pre-commit` to activate the hooks.

## Cra project

- [Live Folder plugin guide](https://github.com/VictorKildahl/cra/blob/v0.1.50/docs/live-folder-plugins.md)
- [Cra brand mark](https://github.com/VictorKildahl/cra/tree/3b96bad2d0735963d9701c4035d2136e453cc197/brand) by the Cra project
