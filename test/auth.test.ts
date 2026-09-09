import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "../src/auth.ts";

test("pbkdf2 hashes verify and reject wrong passwords", async () => {
  const stored = await hashPassword("correct-horse-battery");
  assert.match(stored, /^pbkdf2:100000:[0-9a-f]+:[0-9a-f]+$/);
  assert.equal(await verifyPassword("correct-horse-battery", stored), true);
  assert.equal(await verifyPassword("wrong-password-value", stored), false);
});

test("legacy salt:sha256 hashes still verify", async () => {
  const salt = "aabbccddeeff0011";
  const password = "legacy-pass-ok";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + password));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  assert.equal(await verifyPassword(password, `${salt}:${hash}`), true);
  assert.equal(await verifyPassword("nope", `${salt}:${hash}`), false);
});
