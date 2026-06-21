using AbilityTracker.Import;
using AbilityTracker.Services;
using System.Drawing.Imaging;
using System.Net;

namespace AbilityTracker.Tests;

[TestClass]
public sealed class StorageTests
{
    [TestMethod]
    public async Task RotationRoundTripsAsVersionedJson()
    {
        var root = Path.Combine(Path.GetTempPath(), "AbilityTrackerTests", Guid.NewGuid().ToString("N"));
        try
        {
            var storage = new AppStorage(root, root);
            var document = new RotationParser().Parse("Phase 1\n:a: → :b:", "Test rotation");
            var path = await storage.SaveRotationAsync(document);
            var loaded = await storage.LoadRotationAsync(path);

            Assert.IsNotNull(loaded);
        Assert.AreEqual(3, loaded.Version);
            Assert.AreEqual("Test rotation", loaded.Name);
            CollectionAssert.AreEqual(new[] { "a", "b" }, loaded.Tokens.Keys.OrderBy(value => value).ToArray());
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    [TestMethod]
    public void SynchronousClosePathPersistsWithoutAsyncContext()
    {
        var root = Path.Combine(Path.GetTempPath(), "AbilityTrackerTests", Guid.NewGuid().ToString("N"));
        try
        {
            var storage = new AppStorage(root, root);
            var document = new RotationParser().Parse("Phase 1\n:a: → :b:", "Close test");
            var path = storage.SaveRotation(document);
            storage.SaveSettings(new AbilityTracker.Domain.TrackerSettings { LastRotationFile = path });

            Assert.IsTrue(File.Exists(path));
            Assert.IsTrue(File.Exists(storage.SettingsFile));
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [TestMethod]
    public async Task WikiIconCacheWorksOfflineAfterFirstDownload()
    {
        var root = Path.Combine(Path.GetTempPath(), "AbilityTrackerTests", Guid.NewGuid().ToString("N"));
        try
        {
            byte[] png;
            using (var bitmap = new Bitmap(2, 2))
            using (var stream = new MemoryStream())
            {
                bitmap.SetPixel(0, 0, Color.Gold);
                bitmap.Save(stream, ImageFormat.Png);
                png = stream.ToArray();
            }
            var handler = new StaticImageHandler(png);
            using var service = new WikiIconService(new AppStorage(root, root), handler);
            var candidate = new WikiIconCandidate { Title = "Test", IconUrl = "https://example.invalid/Test.png", FileSha1 = "abc123" };

            var first = await service.CacheAsync(candidate);
            var second = await service.CacheAsync(candidate);

            Assert.AreEqual(first, second);
            Assert.IsTrue(File.Exists(first));
            Assert.AreEqual(1, handler.RequestCount);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    private sealed class StaticImageHandler(byte[] content) : HttpMessageHandler
    {
        public int RequestCount { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestCount++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(content) });
        }
    }
}
