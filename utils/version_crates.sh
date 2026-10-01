#!/usr/bin/env bash
set -euo pipefail

crates_dir="./crates"

for crate_path in "$crates_dir"/*/; do
	echo "Processing crate: $crate_path"

	crate="$(basename "$crate_path")"
	package_file="$crate_path/package.json"
	cargo_toml="$crate_path/Cargo.toml"

	[ -f "$package_file" ] || continue
	[ -f "$cargo_toml" ] || continue

	package_version="$(jq -r '.version' "$package_file")"
	cargo_version="$(sed -n 's/^version = "\(.*\)"/\1/p' "$cargo_toml" | head -n1)"

	if [ "$package_version" != "$cargo_version" ]; then
		sed -i "0,/^version = \".*\"/s//version = \"$package_version\"/" "$cargo_toml"

		(
			cd "$crate_path"
			cargo generate-lockfile --offline
			git add Cargo.toml Cargo.lock
		)
	fi
done

# if any versions were updated, amend the last changeset commit.
if git diff --cached --quiet; then
	echo "No version updates."
else
	git commit --amend --no-edit
fi
