# Security Specification & Invariants — Hotel Income Auditor Firestore Vault

## 1. Data Invariants
1. **Strict Ownership**: Every `/workspaces/{workspaceId}` document must have `ownerId == request.auth.uid` and verified email (`request.auth.token.email_verified == true`).
2. **Master Gate Enforcement**: Subcollections (`rooms`, `ledgerEntries`, `records`) validate parent workspace ownership using `get(/databases/$(database)/documents/workspaces/$(workspaceId)).data.ownerId == request.auth.uid`.
3. **Permanent Retention (Zero Hard Delete)**: `allow delete: if false;` on `users`, `workspaces`, `rooms`, `ledgerEntries`, and `records` guarantees no financial or room record can ever be permanently wiped via the client SDK. Removal in UI sets `isArchived: true` so records remain recoverable indefinitely.
4. **Immutable Ownership & Timestamps**: `ownerId`, `workspaceId`, and `createdAt` are immutable after creation. `createdAt == request.time` on create; `updatedAt == request.time` on update.
5. **Strict Schema & Bounds**: Every string has `.size()` checks; IDs enforce `^[a-zA-Z0-9_\-]+$` and `<= 128` chars; `keys().hasAll(...) && keys().hasOnly(...)` blocks shadow fields; updates enforce `affectedKeys().hasOnly(...)`.

## 2. Dirty Dozen Attack Vectors (Expected: PERMISSION_DENIED)
1. **Unauthenticated Write**: Creating a room or workspace with `request.auth == null`.
2. **Unverified Email Write**: Creating or updating a workspace with `email_verified: false`.
3. **Cross-Tenant Spoofing**: User B creating a workspace with `ownerId: userA_uid`.
4. **Shadow Field Injection**: Adding `isAdmin: true` or `bypassAudit: true` on `create` or `update`.
5. **Role Escalation on Profile**: User setting `role: 'admin'` on `/users/{userId}` creation or updating `role`.
6. **Hard Deletion Attempt**: Calling `deleteDoc` on `/workspaces/{ws}/rooms/{roomId}` or `/ledgerEntries/{id}`.
7. **Timestamp Forgery**: Providing a backdated client timestamp for `createdAt` or `updatedAt != request.time`.
8. **ID Poisoning**: Creating a document with an ID longer than 128 characters or containing `/` / spaces.
9. **Parent Hijack**: Attempting to change `ownerId` or `workspaceId` during an `update`.
10. **Unbounded String / Denial of Wallet**: Sending a 500KB string in `guestOrDescription` or `notes`.
11. **Invalid Enum Injection**: Writing `status: 'HackedStatus'` to a room or `recordType: 'arbitrary'` to `records`.
12. **Unscoped List Query**: Listing `/workspaces` without `where('ownerId', '==', auth.uid)` (rejected by `allow list: if isVerifiedUser() && resource.data.ownerId == request.auth.uid`).
