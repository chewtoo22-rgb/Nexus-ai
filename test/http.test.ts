import assert from "node:assert/strict";
import { test } from "node:test";
import { needsAuth } from "../src/http.ts";
import { normalizeAgent } from "../src/missions.ts";
import { assertPublicHttpUrl, isOwnedObjectKey } from "../src/security.ts";
import { modelKeyForAgent } from "../src/models.ts";
import { ANON_TOOL_NAMES, getToolsForAgent } from "../src/tools.ts";

test("needsAuth gates tenant data and dangerous surfaces", () => {
  assert.equal(needsAuth("/api/missions", "GET"), true);
  assert.equal(needsAuth("/api/conversations/abc", "GET"), true);
  assert.equal(needsAuth("/api/artifacts/abc", "GET"), true);
  assert.equal(needsAuth("/api/projects", "GET"), true);
  assert.equal(needsAuth("/api/search", "POST"), true);
  assert.equal(needsAuth("/api/browser/screenshot", "POST"), true);
  assert.equal(needsAuth("/api/sandbox/exec", "POST"), true);
  assert.equal(needsAuth("/api/images/x", "GET"), true);
  assert.equal(needsAuth("/api/plugins", "GET"), true);
  assert.equal(needsAuth("/api/code/run", "POST"), true);
  assert.equal(needsAuth("/api/chat", "POST"), false);
  assert.equal(needsAuth("/api/health", "GET"), false);
  assert.equal(needsAuth("/api/models", "GET"), false);
  assert.equal(needsAuth("/api/connectors", "GET"), false);
  assert.equal(needsAuth("/api/connectors/install", "POST"), true);
  assert.equal(needsAuth("/api/auth/login", "POST"), false);
});

test("normalizeAgent aliases specialist names", () => {
  assert.equal(normalizeAgent("builder"), "ana");
  assert.equal(normalizeAgent("researcher"), "nova");
  assert.equal(normalizeAgent("analyst"), "sirius");
  assert.equal(normalizeAgent("nexus"), "sirius");
  assert.equal(normalizeAgent("not-a-real-agent"), "sirius");
  assert.equal(normalizeAgent("nova"), "nova");
});

test("modelKeyForAgent maps aliases onto model buckets", () => {
  assert.equal(modelKeyForAgent("sirius"), "analyst");
  assert.equal(modelKeyForAgent("ana"), "builder");
  assert.equal(modelKeyForAgent("nova"), "researcher");
  assert.equal(modelKeyForAgent("nexus"), "nexus");
  assert.equal(modelKeyForAgent("unknown"), "nexus");
});

test("assertPublicHttpUrl blocks private and local targets", () => {
  assert.equal(assertPublicHttpUrl("https://example.com/a").hostname, "example.com");
  assert.throws(() => assertPublicHttpUrl("http://127.0.0.1/"), /not allowed|Private/);
  assert.throws(() => assertPublicHttpUrl("http://localhost/"), /not allowed/);
  assert.throws(() => assertPublicHttpUrl("http://192.168.1.4/"), /Private/);
  assert.throws(() => assertPublicHttpUrl("http://10.0.0.1/"), /Private/);
  assert.throws(() => assertPublicHttpUrl("http://169.254.169.254/latest"), /not allowed|Private/);
  assert.throws(() => assertPublicHttpUrl("file:///etc/passwd"), /http/);
  assert.throws(() => assertPublicHttpUrl("https://metadata.google.internal/"), /not allowed/);
});

test("isOwnedObjectKey only allows that user's prefixes", () => {
  const user = "user-a";
  assert.equal(isOwnedObjectKey("images/user-a/1.png", user), true);
  assert.equal(isOwnedObjectKey("screenshots/user-a/1.png", user), true);
  assert.equal(isOwnedObjectKey("audio/tts/user-a/1.mp3", user), true);
  assert.equal(isOwnedObjectKey("documents/user-a/x.txt", user), true);
  assert.equal(isOwnedObjectKey("images/user-b/1.png", user), false);
  assert.equal(isOwnedObjectKey("images/user-b/user-a/1.png", user), false);
  assert.equal(isOwnedObjectKey("../images/user-a/1.png", user), false);
  assert.equal(isOwnedObjectKey("/images/user-a/1.png", user), false);
  assert.equal(isOwnedObjectKey("user-a/secret.png", user), false);
});

test("anonymous chat gets a cheap tool subset", () => {
  const anon = getToolsForAgent("nexus", { authenticated: false });
  assert.ok(anon.every((t) => ANON_TOOL_NAMES.has(t.name)));
  assert.ok(!anon.some((t) => t.name === "run_code" || t.name === "generate_image" || t.name === "browser_navigate"));
  const authed = getToolsForAgent("builder", { authenticated: true });
  assert.ok(authed.some((t) => t.name === "run_code"));
  const ana = getToolsForAgent("ana", { authenticated: true });
  assert.ok(ana.some((t) => t.name === "run_code"));
});
