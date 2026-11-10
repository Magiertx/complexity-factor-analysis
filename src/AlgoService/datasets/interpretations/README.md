Precomputed interpretations of the bundled datasets, written by
`scripts/precompute_interpretations.py` (needs `ANTHROPIC_API_KEY`):

- `<dataset id>.<language>.json` for the default analysis parameters,
- `<dataset id>.published.<language>.json` for the published options of the dataset
  ("Paper settings"; only datasets that have them).

The API serves them without a key, so the offline demo shows them. Each file names the model,
the effort and the prompt it was made with; files made for another prompt are not served.
