using System.Net;
using System.Text;
using AbilityTracker.Services;

namespace AbilityTracker.Tests;

[TestClass]
public sealed class PvmeImportTests
{
    private const string TestLink = "https://discordapp.com/channels/534508796639182860/1252206384318251061";

    [TestMethod]
    public void ParsesDiscordAppAndDiscordChannelLinks()
    {
        var first = PvmeImportService.ParseDiscordLink(TestLink);
        var second = PvmeImportService.ParseDiscordLink("https://discord.com/channels/534508796639182860/1252206384318251061/999999");

        Assert.AreEqual(PvmeImportService.PvmeGuildId, first.GuildId);
        Assert.AreEqual("1252206384318251061", first.ChannelId);
        Assert.AreEqual("999999", second.MessageId);
    }

    [TestMethod]
    public void ExtractsMultipleRotationsAndNormalizesDiscordEmoji()
    {
        var guide = """
            # Boss
            ## __Safe Rotation__ <:equilibrium:123>
            ### __Phase 1__
            <:anti:111> → <:cade:222>
            ## __Fast Rotation__
            ### __Phase 1__
            <:surge:333> → <:dive:444>
            ## Examples
            no rotation here
            """;

        var rotations = PvmeImportService.ExtractRotations(guide, "Boss guide");

        Assert.AreEqual(2, rotations.Count);
        Assert.AreEqual("Safe Rotation", rotations[0].Name);
        StringAssert.Contains(rotations[0].SourceText, "Phase 1");
        StringAssert.Contains(rotations[0].SourceText, ":anti: → :cade:");
        Assert.AreEqual("111", rotations[0].Emojis["anti"].Id);
        StringAssert.Contains(rotations[0].Emojis["anti"].IconUrl, "/111.png");
        Assert.AreEqual("222", rotations[0].Emojis["cade"].Id);
        Assert.AreEqual("Fast Rotation", rotations[1].Name);
    }

    [TestMethod]
    public async Task TestChannelMapsToPublicGuideAndReturnsEveryRotation()
    {
        using var service = new PvmeImportService(new PvmeHandler());
        var import = await service.ImportAsync(TestLink);

        Assert.AreEqual("Necromancy Telos", import.ChannelName);
        Assert.AreEqual("rs3-full-boss-guides/telos/necromancy.txt", import.RepositoryPath);
        Assert.AreEqual(2, import.Rotations.Count);
    }

    private sealed class PvmeHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var content = request.RequestUri!.AbsoluteUri.Contains("channels.json", StringComparison.OrdinalIgnoreCase)
                ? "[{\"name\":\"Necromancy Telos\",\"path\":\"rs3-full-boss-guides/telos/necromancy.txt\",\"id\":\"1252206384318251061\"}]"
                : "## Safe Rotation\n### Phase 1\n<:anti:1> → <:cade:2>\n## Fast Rotation\n### Phase 1\n<:surge:3> → <:dive:4>";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(content, Encoding.UTF8, "application/json")
            });
        }
    }
}
