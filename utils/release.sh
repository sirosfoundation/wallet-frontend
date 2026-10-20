#!/usr/bin/env bash
#
# Creates a release/vX.Y.Z branch from the default branch,
# bumps the version with changesets, tags it, pushes it and opens a PR.

set -euo pipefail

BASE_BRANCH="release/sirosid"
REMOTE="${REMOTE:-origin}"

# Set by bump_version
VERSION=""
RELEASE_BRANCH=""

main() {
	check_preconditions
	update_base_branch
	bump_version
	tag_release

	if ! confirm "Push $RELEASE_BRANCH and its tags to $REMOTE?"; then
		echo "Not pushed. To push later, run:"
		echo "  git push --follow-tags --set-upstream $REMOTE $RELEASE_BRANCH"
		exit 0
	fi

	push_release
	open_pull_request
}

check_preconditions() {
	if ! working_tree_is_clean; then
		fail "Working tree is not clean. Commit or stash your changes first."
	fi

	if [[ ! -f .changeset/.env && -z "${GITHUB_TOKEN:-}" ]]; then
		fail "No GitHub token. Copy .changeset/.env.example to .changeset/.env and set GITHUB_TOKEN."
	fi
}

update_base_branch() {
	step "Updating $BASE_BRANCH from $REMOTE"

	git fetch "$REMOTE" --tags
	git switch "$BASE_BRANCH"
	git merge --ff-only "$REMOTE/$BASE_BRANCH"
}

bump_version() {
	local previous_version
	previous_version=$(package_version)

	step "Bumping version (current: $previous_version)"

	# Temporary name, since the new version isn't known yet
	git switch -C release/__next__
	pnpm run version

	VERSION=$(package_version)
	RELEASE_BRANCH="release/v$VERSION"

	if [[ "$VERSION" == "$previous_version" ]]; then
		fail "Version was not bumped. Are there any pending changesets?"
	fi

	if ! working_tree_is_clean; then
		fail "'pnpm run version' left uncommitted changes."
	fi

	if git rev-parse --quiet --verify "refs/tags/v$VERSION" >/dev/null; then
		fail "Tag v$VERSION already exists."
	fi

	if git ls-remote --exit-code --heads "$REMOTE" "$RELEASE_BRANCH" >/dev/null; then
		fail "Branch $RELEASE_BRANCH already exists on $REMOTE."
	fi

	git branch --move --force "$RELEASE_BRANCH"
}

tag_release() {
	step "Tagging $RELEASE_BRANCH"

	pnpm run tag

	echo
	echo "Release commit:"
	git log --oneline -1
	echo
	echo "Tags:"
	git tag --points-at HEAD
	echo
}

push_release() {
	step "Pushing $RELEASE_BRANCH"

	# --follow-tags pushes only the annotated tags on this branch
	git push --follow-tags --set-upstream "$REMOTE" "$RELEASE_BRANCH"
}

open_pull_request() {
	if ! command -v gh >/dev/null; then
		echo "gh is not installed. Open a PR from $RELEASE_BRANCH into $BASE_BRANCH,"
		echo "and merge it with a merge commit."
		return
	fi

	step "Opening pull request"

	gh pr create \
		--base "$BASE_BRANCH" \
		--head "$RELEASE_BRANCH" \
		--title "Release v$VERSION" \
		--body "$(changelog_section "$VERSION")"
}

# Prints the CHANGELOG.md lines between "## <version>" and the next "## " heading.
changelog_section() {
	awk -v heading="## $1" '
		$0 == heading       { in_section = 1; next }
		in_section && /^## / { exit }
		in_section          { print }
	' CHANGELOG.md
}

package_version() {
	node -p "require('./package.json').version"
}

working_tree_is_clean() {
	[[ -z "$(git status --porcelain)" ]]
}

confirm() {
	local answer
	read -rp "$1 [y/N] " answer
	[[ "$answer" == [yY] ]]
}

step() {
	echo
	echo "== $*"
}

fail() {
	echo "error: $*" >&2
	exit 1
}

main "$@"
