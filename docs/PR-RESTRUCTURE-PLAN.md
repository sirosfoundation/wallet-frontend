# PR Stack Restructure Plan

**Date:** 2026-04-03
**Author:** Copilot analysis
**Goal:** Merge feat/v2-openid-transports → release/sirosid for next release

---

## Current State

### Branch Relationship

```
release/sirosid (15227f77)
       └── feat/v2-openid-transports (+31 commits, 5f0e8170)
              └── phase-4/trust-types (+2 commits) ← PR #16 READY

phase-5/invite-pin (DIVERGED - created before PRs #13-15)
       └── phase-6/format-handling (+8 commits)
              └── phase-7/authzen-trust (+3 commits)
```

### Key Finding: Invite Code Already Present

✅ **Commit `f0ca610a` (invite code support) is ALREADY in both `release/sirosid` and `feat/v2-openid-transports`**

The commit `a015c96d` identified in phase-5 is a partial/duplicate that only touches `en.json`.
The full implementation via PR #11 merge (`1cf5b05d`) is already integrated.

**We can SKIP PR A (invite code) entirely.**

### PR Stack Status

| PR | Branch | Base | Status | Unique Commits | Action |
|----|--------|------|--------|----------------|--------|
| #16 | phase-4/trust-types | feat/v2-openid-transports | ✅ CLEAN | 2 | **Merge now** |
| #17 | phase-5/invite-pin | phase-4/trust-types | ❌ CONFLICTING | diverged | **Close** |
| #18 | phase-6/format-handling | phase-5/invite-pin | ⚠️ UNSTABLE | 8 | **Replace** |
| #29 | phase-7/authzen-trust | phase-6/format-handling | ⚠️ UNSTABLE | 3 | **Replace** |

### What's Already in feat/v2-openid-transports

These features are DONE and ready to merge into release/sirosid:
- ✅ Transport abstraction layer (PR #13)
- ✅ Automatic token refresh (PR #14)
- ✅ P0/P1 improvements including TxCodeInputPopup (PR #15)
- ✅ Invite code support (via PR #11 merge, commit f0ca610a)

---

## Revised Restructure Plan

### Step 1: Merge PR #16 (Trust Types)

PR #16 is clean and ready. Merge it into feat/v2-openid-transports.

```bash
gh pr merge 16 --squash
```

### Step 2: Create New PR B - Format Handling

**Branch:** `feature/format-handling-v2`
**Base:** `feat/v2-openid-transports` (after PR #16)

Cherry-pick from phase-6:
```bash
git checkout -b feature/format-handling-v2 origin/feat/v2-openid-transports
git cherry-pick aceb393f b12f7d40 23f14d57 e156e002 a4cd7eab 35887484 4fe6eed6 4e1a7056
```

Files (~22):
- Format handling in OID4VCI/OID4VP services
- jwt_vc_json support
- TypeScript fixes
- wallet-common update
- Design documentation

### Step 3: Create New PR C - AuthZEN Trust

**Branch:** `feature/authzen-trust-v2`
**Base:** PR B (or fvot if B merged)

Cherry-pick from phase-7:
```bash
git cherry-pick a2ec4c2d 46a1fef9 31847f77
```

Files (~8):
- `src/lib/services/TrustEvaluator.ts` (new)
- Integration into OID4VCI/OID4VP
- Deprecation of verifyRequestUriAndCerts

### Step 4: Close Superseded PRs

After new PRs are merged:
```bash
gh pr close 17 --comment "Superseded by restructured PR stack"
gh pr close 18 --comment "Superseded by PR #XX (feature/format-handling-v2)"
gh pr close 29 --comment "Superseded by PR #XX (feature/authzen-trust-v2)"
```

### Step 5: Final Merge to release/sirosid

Once all features are in feat/v2-openid-transports:
```bash
git checkout release/sirosid
git merge feat/v2-openid-transports
git push origin release/sirosid
```

---

## Optional: PIN Popup Updates

The PIN popup updates from phase-5 (`d7f42946`, `e369d437`) add:
- `src/components/Popups/PinPopup.tsx` (new file)
- Refactored `PinInput.jsx`
- Enhanced `UriHandlerProvider.tsx`

**Recommendation:** Handle as a **separate follow-up PR** after AuthZEN trust, because:
1. Not blocking for the release
2. Touches UriHandlerProvider which AuthZEN also modifies
3. Can be reviewed independently

---

## Execution Checklist

- [ ] **Step 1:** Merge PR #16 (trust types)
- [ ] **Step 2:** Create `feature/format-handling-v2` branch and cherry-pick
- [ ] **Step 2a:** Open PR B, review, merge
- [ ] **Step 3:** Create `feature/authzen-trust-v2` branch and cherry-pick
- [ ] **Step 3a:** Open PR C, review, merge
- [ ] **Step 4:** Close PRs #17, #18, #29 as superseded
- [ ] **Step 5:** Merge feat/v2-openid-transports → release/sirosid

**Estimated new PRs:** 2 (format-handling + authzen-trust)

---

## Summary

| Action | Item | Notes |
|--------|------|-------|
| **MERGE** | PR #16 | Trust types - ready |
| **SKIP** | PR #17 / invite code | Already in fvot via f0ca610a |
| **REPLACE** | PR #18 | New PR B: format-handling-v2 |
| **REPLACE** | PR #29 | New PR C: authzen-trust-v2 |
| **DEFER** | PIN popup updates | Follow-up PR after release |

