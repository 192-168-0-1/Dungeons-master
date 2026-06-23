import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const bootstrapSource = html.match(/<script>\s*(\(function bootstrapDungeons\(\)[\s\S]*?)\s*<\/script>/)?.[1];
const flushAsyncWork = () => new Promise((resolve) => setImmediate(resolve));

function createBootstrapRuntime(fetchImpl) {
  const timers = [];
  const listeners = {};
  const appendedToHead = [];
  const appendedToBody = [];
  const elements = {
    environment: { textContent: "Loading…" },
    status: { textContent: "Initializing…", dataset: {} },
  };
  const window = {
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      timer.cleared = true;
    },
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
  };
  const document = {
    getElementById(id) {
      return elements[id];
    },
    createElement(tagName) {
      return {
        tagName,
        remove() {},
      };
    },
    head: {
      appendChild(element) {
        appendedToHead.push(element);
      },
    },
    body: {
      appendChild(element) {
        appendedToBody.push(element);
      },
    },
  };

  vm.runInNewContext(bootstrapSource, {
    Date,
    Error,
    Promise,
    document,
    encodeURIComponent,
    fetch: fetchImpl,
    window,
  });

  return { appendedToBody, appendedToHead, elements, listeners, timers, window };
}

test("Alt1 bootstrap starts the cached app when version.json hangs", async () => {
  assert.ok(bootstrapSource, "bootstrap script should exist");
  const runtime = createBootstrapRuntime(() => new Promise(() => {}));
  await Promise.resolve();

  const fallbackTimer = runtime.timers.find((timer) => timer.delay === 2500);
  assert.ok(fallbackTimer, "fallback timer should be scheduled");
  fallbackTimer.callback();

  assert.equal(runtime.appendedToBody.length, 1);
  assert.equal(runtime.appendedToBody[0].type, "module");
  assert.match(runtime.appendedToBody[0].src, /^\.\/app\.js\?v=20260623-1$/);
});

test("failed OCR loading does not block the core Alt1 app", async () => {
  const runtime = createBootstrapRuntime(() => Promise.reject(new Error("offline")));
  await flushAsyncWork();

  assert.equal(runtime.appendedToBody.length, 1);
  assert.equal(runtime.appendedToHead.length, 1);
  assert.match(runtime.appendedToBody[0].src, /^\.\/app\.js\?v=20260623-1$/);

  runtime.appendedToHead[0].onerror();
  await runtime.window.__dungeonsOcrReady;
  assert.ok(runtime.window.__dungeonsOcrLoadError instanceof Error);
  assert.equal(runtime.appendedToBody.length, 1);
});

test("core module failures replace the indefinite loading message", async () => {
  const runtime = createBootstrapRuntime(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ version: "test-version" }),
  }));
  await flushAsyncWork();

  assert.equal(runtime.appendedToBody.length, 1);
  runtime.appendedToBody[0].onerror();
  assert.equal(runtime.elements.environment.textContent, "Load failed");
  assert.match(runtime.elements.status.textContent, /could not load/i);
  assert.equal(runtime.elements.status.dataset.tone, "error");
});

test("startup watchdog replaces a module that never finishes initializing", async () => {
  const runtime = createBootstrapRuntime(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ version: "test-version" }),
  }));
  await flushAsyncWork();

  const watchdog = runtime.timers.find((timer) => timer.delay === 12000);
  assert.ok(watchdog, "startup watchdog should be scheduled");
  watchdog.callback();

  assert.equal(runtime.elements.environment.textContent, "Load failed");
  assert.match(runtime.elements.status.textContent, /did not finish starting/i);
  assert.equal(runtime.elements.status.dataset.tone, "error");
});

test("startup runtime errors surface the actual module error", async () => {
  const runtime = createBootstrapRuntime(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ version: "test-version" }),
  }));
  await flushAsyncWork();

  runtime.listeners.error({ error: new Error("storage denied") });

  assert.equal(runtime.window.__dungeonsAppReady, true);
  assert.equal(runtime.elements.environment.textContent, "Load failed");
  assert.match(runtime.elements.status.textContent, /storage denied/);
  assert.equal(runtime.elements.status.dataset.tone, "error");
});

test("startup watchdog leaves a ready app untouched", async () => {
  const runtime = createBootstrapRuntime(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ version: "test-version" }),
  }));
  await flushAsyncWork();

  runtime.window.__dungeonsAppReady = true;
  const watchdog = runtime.timers.find((timer) => timer.delay === 12000);
  watchdog.callback();

  assert.equal(runtime.elements.environment.textContent, "Starting…");
  assert.equal(runtime.elements.status.textContent, "Starting Dungeons…");
});
