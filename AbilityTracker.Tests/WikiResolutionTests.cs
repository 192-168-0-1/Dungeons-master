using System.Net;
using System.Text;
using AbilityTracker.Domain;
using AbilityTracker.Services;

namespace AbilityTracker.Tests;

[TestClass]
public sealed class WikiResolutionTests
{
    [TestMethod]
    public void ClassifiesAbilityPerkAndItemInfoboxes()
    {
        Assert.AreEqual(WikiPageKind.Ability, WikiIconService.ClassifyWikitext("{{Infobox Ability\n|image=A.png}}"));
        Assert.AreEqual(WikiPageKind.Perk, WikiIconService.ClassifyWikitext("{{Infobox Perk|name=Clear Headed}}"));
        Assert.AreEqual(WikiPageKind.Item, WikiIconService.ClassifyWikitext("{{Infobox Item|name=Potion}}"));
        Assert.AreEqual(WikiPageKind.Other, WikiIconService.ClassifyWikitext("{{Infobox NPC|name=Cade}}"));
    }

    [TestMethod]
    public void SplitsKnownAbilityAndPerkCombinations()
    {
        var anticipation = WikiIconService.TryCreateCompositePlan("anticlearheaded");
        var barricade = WikiIconService.TryCreateCompositePlan("cadeturtling4");

        Assert.IsNotNull(anticipation);
        Assert.AreEqual("Anticipation", anticipation.AbilityTitle);
        Assert.AreEqual("Clear Headed", anticipation.Modifiers.Single().DisplayTitle);
        Assert.IsNotNull(barricade);
        Assert.AreEqual("Barricade", barricade.AbilityTitle);
        Assert.AreEqual("Turtling 4", barricade.Modifiers.Single().DisplayTitle);
    }

    [TestMethod]
    public async Task CadePrefersBarricadeAbilityInsteadOfSameNamedNpc()
    {
        var root = Path.Combine(Path.GetTempPath(), "AbilityTrackerTests", Guid.NewGuid().ToString("N"));
        try
        {
            using var service = new WikiIconService(new AppStorage(root, root), new WikiRoutingHandler());
            var results = await service.SearchAsync(new TokenDefinition { Id = "cade", DisplayName = "Cade" });

            Assert.AreEqual("Barricade", results.First().Title);
            Assert.AreEqual(WikiPageKind.Ability, results.First().PageKind);
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [TestMethod]
    public async Task AntiAlwaysResolvesToAnticipationAbility()
    {
        var root = Path.Combine(Path.GetTempPath(), "AbilityTrackerTests", Guid.NewGuid().ToString("N"));
        try
        {
            using var service = new WikiIconService(new AppStorage(root, root), new WikiRoutingHandler());
            var result = (await service.SearchAsync(new TokenDefinition { Id = "anti", DisplayName = "Anti" })).First();

            Assert.AreEqual("Anticipation", result.Title);
            Assert.AreEqual(WikiPageKind.Ability, result.PageKind);
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [TestMethod]
    public async Task CompositeUsesAbilityIconAndStoresPerkAsModifier()
    {
        var root = Path.Combine(Path.GetTempPath(), "AbilityTrackerTests", Guid.NewGuid().ToString("N"));
        try
        {
            using var service = new WikiIconService(new AppStorage(root, root), new WikiRoutingHandler());
            var results = await service.SearchAsync(new TokenDefinition { Id = "anticlearheaded", DisplayName = "Anticlearheaded" });
            var result = results.First();

            Assert.AreEqual("Anticipation", result.Title);
            Assert.AreEqual(WikiPageKind.Ability, result.PageKind);
            Assert.IsTrue(result.IsComposite);
            CollectionAssert.AreEqual(new[] { "Clear Headed" }, result.Modifiers);
            StringAssert.Contains(result.IconUrl, "Anticipation.png");
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [TestMethod]
    public async Task AutomaticResolutionUsesDirectWikiPageWithoutBroadSearch()
    {
        var root = Path.Combine(Path.GetTempPath(), "AbilityTrackerTests", Guid.NewGuid().ToString("N"));
        try
        {
            var handler = new CountingWikiHandler();
            using var service = new WikiIconService(new AppStorage(root, root), handler);
            var result = await service.ResolveBestAsync(new TokenDefinition { Id = "assault", DisplayName = "Assault" });

            Assert.IsNotNull(result);
            Assert.AreEqual("Assault", result.Title);
            Assert.AreEqual(WikiPageKind.Ability, result.PageKind);
            Assert.AreEqual(0, handler.OpenSearchRequests);
            Assert.AreEqual(2, handler.Requests);
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [TestMethod]
    public async Task CompactPvmeTokenFallsBackWithoutBroadAmbiguousWikiSearch()
    {
        var root = Path.Combine(Path.GetTempPath(), "AbilityTrackerTests", Guid.NewGuid().ToString("N"));
        try
        {
            var handler = new CountingWikiHandler();
            using var service = new WikiIconService(new AppStorage(root, root), handler);
            var token = new TokenDefinition
            {
                Id = "havocgop",
                DisplayName = "Havocgop",
                SourceIconUrl = "https://cdn.discordapp.com/emojis/123.png",
                SourceIconLabel = "PvME :havocgop:"
            };

            var result = await service.ResolveBestAsync(token);
            await service.ApplySourceIconAsync(token);

            Assert.IsNull(result);
            Assert.AreEqual(0, handler.OpenSearchRequests);
            Assert.IsTrue(token.IconConfirmed);
            Assert.IsTrue(File.Exists(token.CachedIconFile));
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    private sealed class WikiRoutingHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var uri = Uri.UnescapeDataString(request.RequestUri!.AbsoluteUri);
            string json;
            if (uri.Contains("action=opensearch", StringComparison.Ordinal) && uri.Contains("search=Barricade", StringComparison.OrdinalIgnoreCase))
                json = "[\"Barricade\",[\"Barricade\",\"Cade\"],[\"\",\"\"],[\"\",\"\"]]";
            else if (uri.Contains("action=opensearch", StringComparison.Ordinal) && uri.Contains("search=Anticipation", StringComparison.OrdinalIgnoreCase))
                json = "[\"Anticipation\",[\"Anticipation\"],[\"\"],[\"\"]]";
            else if (uri.Contains("action=opensearch", StringComparison.Ordinal))
                json = "[\"query\",[],[],[]]";
            else if (uri.Contains("action=parse", StringComparison.Ordinal) && uri.Contains("page=Barricade", StringComparison.OrdinalIgnoreCase))
                json = Parse("{{Infobox Ability\\n|image = Barricade.png}}");
            else if (uri.Contains("action=parse", StringComparison.Ordinal) && uri.Contains("page=Anticipation", StringComparison.OrdinalIgnoreCase))
                json = Parse("{{Infobox Ability\\n|image = Anticipation.png}}");
            else if (uri.Contains("action=parse", StringComparison.Ordinal) && uri.Contains("page=Clear Headed", StringComparison.OrdinalIgnoreCase))
                json = Parse("{{Infobox Perk|name=Clear Headed}}");
            else if (uri.Contains("File:Barricade.png", StringComparison.OrdinalIgnoreCase))
                json = Image("Barricade.png", "barricadehash");
            else if (uri.Contains("File:Anticipation.png", StringComparison.OrdinalIgnoreCase))
                json = Image("Anticipation.png", "anticipationhash");
            else
                json = "{\"batchcomplete\":true,\"query\":{\"pages\":[{\"ns\":6,\"title\":\"missing\",\"missing\":true}]}}";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            });
        }

        private static string Parse(string wikitext) => "{\"parse\":{\"title\":\"page\",\"wikitext\":\"" + wikitext + "\"}}";
        private static string Image(string file, string hash) =>
            "{\"batchcomplete\":true,\"query\":{\"pages\":[{\"imageinfo\":[{\"url\":\"https://example.invalid/" + file + "\",\"descriptionurl\":\"https://example.invalid/file\",\"sha1\":\"" + hash + "\",\"width\":120,\"height\":120}]}]}}";
    }

    private sealed class CountingWikiHandler : HttpMessageHandler
    {
        public int Requests { get; private set; }
        public int OpenSearchRequests { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests++;
            var uri = Uri.UnescapeDataString(request.RequestUri!.AbsoluteUri);
            if (uri.Contains("action=opensearch", StringComparison.Ordinal)) OpenSearchRequests++;
            string json;
            if (uri.Contains("action=parse", StringComparison.Ordinal) && uri.Contains("page=Assault", StringComparison.OrdinalIgnoreCase))
                json = "{\"parse\":{\"title\":\"Assault\",\"wikitext\":\"{{Infobox Ability\\n|image = Assault.png}}\"}}";
            else if (uri.Contains("File:Assault.png", StringComparison.OrdinalIgnoreCase))
                json = "{\"query\":{\"pages\":[{\"imageinfo\":[{\"url\":\"https://example.invalid/Assault.png\",\"sha1\":\"assaulthash\",\"width\":60,\"height\":60}]}]}}";
            else if (uri.Contains("cdn.discordapp.com", StringComparison.OrdinalIgnoreCase))
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent([1, 2, 3, 4]) });
            else if (uri.Contains("action=opensearch", StringComparison.Ordinal))
                json = "[\"query\",[],[],[]]";
            else
                json = "{\"error\":{\"code\":\"missingtitle\"}}";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            });
        }
    }
}
