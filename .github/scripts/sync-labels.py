#!/usr/bin/env python3
"""Sync GitHub repo labels from the .github/labels.yml manifest (idempotent).

Run by .github/workflows/label-sync.yml. Creates missing labels and updates the
color/description of existing ones. Requires the `gh` CLI authenticated via GH_TOKEN.
Does not delete labels that are absent from the manifest (skip-delete by design).
"""
import subprocess
import sys

import yaml

with open(".github/labels.yml", encoding="utf-8") as fh:
    labels = yaml.safe_load(fh)

failed = []
for entry in labels:
    name = entry["name"]
    color = str(entry["color"])
    desc = entry.get("description", "") or ""
    created = subprocess.run(
        ["gh", "label", "create", name, "--color", color, "--description", desc],
        capture_output=True, text=True,
    )
    if created.returncode == 0:
        print(f"created {name}")
        continue
    edited = subprocess.run(
        ["gh", "label", "edit", name, "--color", color, "--description", desc],
        capture_output=True, text=True,
    )
    if edited.returncode == 0:
        print(f"updated {name}")
    else:
        failed.append(f"{name}: {created.stderr.strip()} / {edited.stderr.strip()}")

if failed:
    print("LABEL SYNC FAILED:")
    for f in failed:
        print("  -", f)
    sys.exit(1)

print(f"label sync complete: {len(labels)} labels")
