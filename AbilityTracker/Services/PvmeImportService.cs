using System.Text.Json;
using System.Text.RegularExpressions;

namespace AbilityTracker.Services;

public sealed partial class PvmeImportService : IDisposable
{
    public const string PvmeGuildId = "534508796639182860";
    private const string ChannelsUrl = "https://raw.githubusercontent.com/pvme/pvme-settings/pvme-discord/channels.json";
    private const string GuidesBaseUrl = "https://raw.githubusercontent.com/pvme/pvme-guides/master/";
    private readonly HttpClient http;

    [GeneratedRegex(@"^https?://(?:www\.)?discord(?:app)?\.com/channels/(?<guild>\d+)/(?<channel>\d+)(?:/(?<message>\d+))?/?(?:\?.*)?$", RegexOptions.IgnoreCase | RegexOptions.Compiled)]
    private static partial Regex DiscordChannelUrlRegex();

    [GeneratedRegex(@"^##\s+(?<title>.+)$", RegexOptions.Compiled)]
    private static partial Regex RotationHeadingRegex();

    [GeneratedRegex(@"<(?<animated>a?):(?<name>[A-Za-z0-9_-]+):(?<id>\d+)>", RegexOptions.Compiled)]
    private static partial Regex DiscordEmojiRegex();

    [GeneratedRegex(@"\[(?<text>[^\]]+)\]\((?:<)?[^)]+(?:>)?\)", RegexOptions.Compiled)]
    private static partial Regex MarkdownLinkRegex();

    public PvmeImportService(HttpMessageHandler? handler = null)
    {
        http = handler is null ? new HttpClient() : new HttpClient(handler);
        http.Timeout = TimeSpan.FromSeconds(20);
        http.DefaultRequestHeaders.UserAgent.ParseAdd("DungeonsAbilityTracker/1.0 (PvME public guide importer)");
    }

    public async Task<PvmeGuideImport> ImportAsync(string discordUrl, CancellationToken cancellationToken = default)
    {
        var link = ParseDiscordLink(discordUrl);
        if (link.GuildId != PvmeGuildId)
            throw new NotSupportedException("Only links from the public PvME Discord server can be imported without Discord authentication.");

        var channelJson = await http.GetStringAsync(ChannelsUrl, cancellationToken).ConfigureAwait(false);
        var channels = JsonSerializer.Deserialize<List<PvmeChannel>>(channelJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? [];
        var channel = channels.FirstOrDefault(candidate => candidate.Id == link.ChannelId)
                      ?? throw new InvalidOperationException("This PvME channel is not present in the public PvME channel mapping.");
        var safePath = channel.Path.Replace('\\', '/').TrimStart('/');
        if (safePath.Contains("..", StringComparison.Ordinal) || !safePath.EndsWith(".txt", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("PvME returned an unsafe or unsupported guide path.");

        var guideText = await http.GetStringAsync(GuidesBaseUrl + string.Join("/", safePath.Split('/').Select(Uri.EscapeDataString)), cancellationToken).ConfigureAwait(false);
        var rotations = ExtractRotations(guideText, channel.Name);
        if (rotations.Count == 0)
            throw new InvalidOperationException("The linked PvME guide contains no rotation sequences.");
        return new PvmeGuideImport(channel.Name, safePath, link, rotations);
    }

    public static DiscordChannelLink ParseDiscordLink(string value)
    {
        var match = DiscordChannelUrlRegex().Match(value.Trim());
        if (!match.Success) throw new FormatException("Use a Discord channel link such as https://discord.com/channels/server/channel.");
        return new DiscordChannelLink(match.Groups["guild"].Value, match.Groups["channel"].Value,
            match.Groups["message"].Success ? match.Groups["message"].Value : null);
    }

    public static IReadOnlyList<PvmeRotationCandidate> ExtractRotations(string guideText, string channelName)
    {
        var lines = guideText.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        var rotationHeadings = new List<(int Index, string Name)>();
        for (var index = 0; index < lines.Length; index++)
        {
            var heading = RotationHeadingRegex().Match(lines[index]);
            if (heading.Success && heading.Groups["title"].Value.Contains("rotation", StringComparison.OrdinalIgnoreCase))
                rotationHeadings.Add((index, CleanInline(heading.Groups["title"].Value)));
        }

        var result = new List<PvmeRotationCandidate>();
        foreach (var (headingIndex, name) in rotationHeadings)
        {
            var end = lines.Length;
            for (var index = headingIndex + 1; index < lines.Length; index++)
            {
                if (RotationHeadingRegex().IsMatch(lines[index])) { end = index; break; }
            }
            var rawSection = string.Join("\n", lines.Skip(headingIndex + 1).Take(end - headingIndex - 1));
            var cleaned = CleanGuideText(rawSection);
            if (ContainsRotation(cleaned)) result.Add(new PvmeRotationCandidate(name, cleaned, ExtractEmojiReferences(rawSection)));
        }

        if (result.Count == 0)
        {
            var cleaned = CleanGuideText(guideText);
            if (ContainsRotation(cleaned)) result.Add(new PvmeRotationCandidate(channelName, cleaned, ExtractEmojiReferences(guideText)));
        }
        return result;
    }

    public static IReadOnlyDictionary<string, PvmeEmojiReference> ExtractEmojiReferences(string value)
    {
        var result = new Dictionary<string, PvmeEmojiReference>(StringComparer.OrdinalIgnoreCase);
        foreach (Match match in DiscordEmojiRegex().Matches(value))
        {
            var name = match.Groups["name"].Value.ToLowerInvariant();
            result[name] = new PvmeEmojiReference(name, match.Groups["id"].Value,
                match.Groups["animated"].Value.Equals("a", StringComparison.OrdinalIgnoreCase));
        }
        return result;
    }

    public static string CleanGuideText(string value)
    {
        value = DiscordEmojiRegex().Replace(value, match => ":" + match.Groups["name"].Value.ToLowerInvariant() + ":");
        value = MarkdownLinkRegex().Replace(value, match => match.Groups["text"].Value);
        var output = new List<string>();
        var insideEmbed = false;
        foreach (var raw in value.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n'))
        {
            var trimmed = raw.Trim();
            if (!insideEmbed && trimmed == "{") { insideEmbed = true; continue; }
            if (insideEmbed)
            {
                if (trimmed.Equals(".embed:json", StringComparison.OrdinalIgnoreCase)) insideEmbed = false;
                continue;
            }
            if (trimmed is "." or "" || trimmed.StartsWith(".tag:", StringComparison.OrdinalIgnoreCase) ||
                trimmed.StartsWith(".img:", StringComparison.OrdinalIgnoreCase) || trimmed.StartsWith(".pin:", StringComparison.OrdinalIgnoreCase))
                continue;

            var heading = Regex.Match(trimmed, @"^#{1,6}\s+(?<title>.+)$");
            if (heading.Success)
            {
                output.Add(CleanInline(heading.Groups["title"].Value));
                continue;
            }

            var line = Regex.Replace(raw, @"<#[0-9]+>", "[Discord channel]");
            line = line.Replace("**", string.Empty).Replace("__", string.Empty).Replace("*", string.Empty);
            line = Regex.Replace(line, @"^\s*[•⬥-]\s*", "⬥ ");
            output.Add(line.TrimEnd());
        }
        return string.Join(Environment.NewLine, output).Trim();
    }

    private static string CleanInline(string value)
    {
        value = DiscordEmojiRegex().Replace(value, string.Empty);
        value = Regex.Replace(value, @"[*_`#]", string.Empty);
        return Regex.Replace(value, @"\s+", " ").Trim();
    }

    private static bool ContainsRotation(string value) => value.Contains('→') || value.Contains("->", StringComparison.Ordinal);
    public void Dispose() => http.Dispose();

    private sealed class PvmeChannel
    {
        public string Name { get; set; } = string.Empty;
        public string Path { get; set; } = string.Empty;
        public string Id { get; set; } = string.Empty;
    }
}

public sealed record DiscordChannelLink(string GuildId, string ChannelId, string? MessageId);
public sealed record PvmeGuideImport(string ChannelName, string RepositoryPath, DiscordChannelLink Link, IReadOnlyList<PvmeRotationCandidate> Rotations);
public sealed record PvmeEmojiReference(string Name, string Id, bool IsAnimated)
{
    public string IconUrl => $"https://cdn.discordapp.com/emojis/{Id}.png?size=128&quality=lossless";
    public string Label => $"PvME :{Name}:";
}

public sealed record PvmeRotationCandidate(
    string Name,
    string SourceText,
    IReadOnlyDictionary<string, PvmeEmojiReference>? EmojiReferences = null)
{
    public IReadOnlyDictionary<string, PvmeEmojiReference> Emojis { get; } =
        EmojiReferences ?? new Dictionary<string, PvmeEmojiReference>(StringComparer.OrdinalIgnoreCase);
    public override string ToString() => Name;
}
