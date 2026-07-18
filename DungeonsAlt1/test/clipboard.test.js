import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIPBOARD_WRITE_FAILURES,
  ClipboardWriteError,
  PNG_CLIPBOARD_MIME_TYPE,
  PNG_CLIPBOARD_WRITE_TIMEOUT_MS,
  classifyClipboardWriteError,
  writePngBlobToClipboard,
} from "../src/clipboard.js";

function pngBlob() {
  return new Blob(["png-bytes"], { type: PNG_CLIPBOARD_MIME_TYPE });
}

function clipboardRoot(write, { supports = true, secure = true } = {}) {
  class FakeClipboardItem {
    static supports(type) {
      assert.equal(type, PNG_CLIPBOARD_MIME_TYPE);
      return supports;
    }

    constructor(data) {
      this.data = data;
    }
  }

  return {
    isSecureContext: secure,
    ClipboardItem: FakeClipboardItem,
    navigator: { clipboard: { write } },
  };
}

test("PNG clipboard defaults are stable", () => {
  assert.equal(PNG_CLIPBOARD_MIME_TYPE, "image/png");
  assert.equal(PNG_CLIPBOARD_WRITE_TIMEOUT_MS, 3000);
});

test("a PNG Blob is written as one ClipboardItem and starts synchronously", async () => {
  const blob = pngBlob();
  let writeStarted = false;
  let written = null;
  const root = clipboardRoot((items) => {
    writeStarted = true;
    written = items;
    return Promise.resolve();
  });

  const pending = writePngBlobToClipboard(blob, root);
  assert.equal(writeStarted, true);
  assert.equal(await pending, true);
  assert.equal(written.length, 1);
  assert.equal(written[0].data[PNG_CLIPBOARD_MIME_TYPE], blob);
});

test("non-PNG input is rejected before clipboard access", async () => {
  let writes = 0;
  const root = clipboardRoot(() => { writes += 1; });
  await assert.rejects(
    writePngBlobToClipboard(new Blob(["text"], { type: "text/plain" }), root),
    (error) => error instanceof ClipboardWriteError
      && error.code === CLIPBOARD_WRITE_FAILURES.InvalidPng,
  );
  assert.equal(writes, 0);
});

test("insecure and unavailable clipboard environments are classified", async () => {
  await assert.rejects(
    writePngBlobToClipboard(pngBlob(), clipboardRoot(() => {}, { secure: false })),
    (error) => error.code === CLIPBOARD_WRITE_FAILURES.InsecureContext,
  );
  await assert.rejects(
    writePngBlobToClipboard(pngBlob(), { isSecureContext: true, navigator: {} }),
    (error) => error.code === CLIPBOARD_WRITE_FAILURES.Unsupported,
  );
});

test("an explicitly unsupported PNG ClipboardItem is not written", async () => {
  let writes = 0;
  const root = clipboardRoot(() => { writes += 1; }, { supports: false });
  await assert.rejects(
    writePngBlobToClipboard(pngBlob(), root),
    (error) => error.code === CLIPBOARD_WRITE_FAILURES.UnsupportedType,
  );
  assert.equal(writes, 0);
});

test("a broken ClipboardItem.supports helper falls through to the real write", async () => {
  const root = clipboardRoot(() => Promise.resolve());
  root.ClipboardItem.supports = () => { throw new Error("CEF supports() failure"); };
  assert.equal(await writePngBlobToClipboard(pngBlob(), root), true);

  root.ClipboardItem.supports = () => undefined;
  assert.equal(await writePngBlobToClipboard(pngBlob(), root), true);
});

test("permission errors are classified as blocked", async () => {
  for (const name of ["NotAllowedError", "SecurityError"]) {
    const denied = new Error("denied");
    denied.name = name;
    const root = clipboardRoot(() => Promise.reject(denied));
    await assert.rejects(
      writePngBlobToClipboard(pngBlob(), root, { timeoutMs: 50 }),
      (error) => error instanceof ClipboardWriteError
        && error.code === CLIPBOARD_WRITE_FAILURES.Blocked
        && error.cause === denied,
    );
  }
});

test("a hanging CEF clipboard write is bounded and classified", async () => {
  const root = clipboardRoot(() => new Promise(() => {}));
  const startedAt = Date.now();
  await assert.rejects(
    writePngBlobToClipboard(pngBlob(), root, { timeoutMs: 10 }),
    (error) => error instanceof ClipboardWriteError
      && error.code === CLIPBOARD_WRITE_FAILURES.Timeout,
  );
  assert.ok(Date.now() - startedAt < 500);
});

test("unexpected write failures keep a generic stable classification", async () => {
  const failure = new Error("native clipboard failure");
  const root = clipboardRoot(() => { throw failure; });
  await assert.rejects(
    writePngBlobToClipboard(pngBlob(), root),
    (error) => error.code === CLIPBOARD_WRITE_FAILURES.Failed
      && error.cause === failure
      && /native clipboard failure/.test(error.message),
  );
  assert.equal(classifyClipboardWriteError(failure), CLIPBOARD_WRITE_FAILURES.Failed);
});
