#!/usr/bin/env python3
"""Validate OpenLogo repo metadata: issue forms, label manifest, labeler, and workflows.

Run in CI (see .github/workflows/ci.yml, meta job). Fails if an issue template or the
labeler references a label that is not defined in .github/labels.yml, or if any of the
metadata YAML files fail to parse.
"""
import glob
import os
import sys

import yaml

errors = []


def load(path):
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


# Label taxonomy is the source of truth.
labels = load(".github/labels.yml")
label_names = {entry["name"] for entry in labels}

# Every issue form's default labels must exist in the manifest.
for fp in sorted(glob.glob(".github/ISSUE_TEMPLATE/*.yml")):
    if os.path.basename(fp) == "config.yml":
        continue
    doc = load(fp)
    for label in doc.get("labels", []) or []:
        if label not in label_names:
            errors.append(f"{fp}: label '{label}' is not defined in labels.yml")

# Every labeler target label must exist in the manifest.
labeler = load(".github/labeler.yml")
for label in labeler.keys():
    if label not in label_names:
        errors.append(f".github/labeler.yml: label '{label}' is not defined in labels.yml")

# All workflows must parse.
for fp in sorted(glob.glob(".github/workflows/*.yml")):
    load(fp)

# Runnable examples are optional early on; note their absence without failing.
if not glob.glob("spec/examples/*.logo"):
    print("note: no spec/examples/*.logo yet (skipping example run in meta)")

if errors:
    print("META VALIDATION FAILED:")
    for e in errors:
        print("  -", e)
    sys.exit(1)

print(f"meta validation passed: {len(label_names)} labels, "
      f"{len(glob.glob('.github/ISSUE_TEMPLATE/*.yml'))} issue forms checked")
