# FlameWill upload artifact

`actions/upload-artifact` (v7, the latest, and v4) with the same inputs and outputs. On a [FlameWill](https://flamewill.com) runner, FlameWill keeps the artifact:
GitHub's artifact storage and its quota are not used, and the artifact is listed and downloaded on your organization's FlameWill
dashboard. Everywhere else, and whenever FlameWill does not keep it, this is `actions/upload-artifact` itself.

```yaml
- uses: FlameWill/upload-artifact@v1   # was: actions/upload-artifact@v4 (or @v7)
  with:
    name: test-report
    path: reports/
```

- **Same files, same layout.** The files are found by `actions/upload-artifact`'s own search (its file, unchanged) (wildcards, `!` excludes, hidden files,
  the common folder of several paths), so the archive holds what GitHub's would.
- **Read it back** in a later job of the same run with [`FlameWill/download-artifact`](https://github.com/FlameWill/download-artifact).
- **GitHub keeps it instead** when the job is not on a FlameWill runner, when `overwrite: true` (FlameWill keeps a name once per run
  attempt), when `archive: false`, when the name has characters other than `A-Z a-z 0-9 . _ -`, or when FlameWill could not keep it. The step says which.
- **Fast:** the artifact goes to storage next to the machine, not across the internet.
- **`kept-by`** output: `flamewill` or `github`.
- How long FlameWill keeps an artifact and what it costs: [flamewill.com/pricing](https://flamewill.com/pricing/).
