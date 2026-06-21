using System.Text.Json;
using System.Text.RegularExpressions;
using System.Security.Cryptography;
using System.Text;
using AbilityTracker.Domain;
using AbilityTracker.Import;

namespace AbilityTracker.Services;

public sealed partial class WikiIconService : IDisposable
{
    private const string ApiBase = "https://runescape.wiki/api.php";
    private readonly AppStorage storage;
    private readonly HttpClient http;

    private static readonly Dictionary<string, string> SearchAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["cade"] = "Barricade",
        ["anti"] = "Anticipation",
        ["bd"] = "Bladed Dive",
        ["gbarge"] = "Greater Barge",
        ["gflurry"] = "Greater Flurry",
        ["gflury"] = "Greater Flurry",
        ["gfury"] = "Greater Fury",
        ["cane"] = "Hurricane",
        ["res"] = "Resonance",
        ["debil"] = "Debilitate",
        ["deci"] = "Decimate",
        ["devo"] = "Devotion",
        ["immort"] = "Immortality",
        ["natty"] = "Natural Instinct",
        ["nat"] = "Natural Instinct",
        ["prep"] = "Preparation",
        ["voke"] = "Provoke",
        ["zerk"] = "Berserk",
        ["sun"] = "Sunshine",
        ["ds"] = "Death's Swiftness",
        ["deathskulls"] = "Death Skulls",
        ["soulsap"] = "Soul Sap",
        ["bloodtendrils"] = "Blood Tendrils",
        ["chaosroar"] = "Chaos Roar",
        ["disrupt"] = "Disruption Shield",
        ["touchofdeath"] = "Touch of Death",
        ["fingerofdeath"] = "Finger of Death",
        ["livingdeath"] = "Living Death",
        ["volleyofsouls"] = "Volley of Souls",
        ["vulnbomb"] = "Vulnerability bomb",
        ["adrenrenewal"] = "Adrenaline renewal potion",
        ["commandskeleton"] = "Command Skeleton Warrior",
        ["commandzombie"] = "Command Putrid Zombie",
        ["commandghost"] = "Command Vengeful Ghost",
        ["conjurearmy"] = "Conjure Undead Army",
        ["necrobasic"] = "Necromancy (ability)",
        ["spec"] = "Special attack",
        ["splitsoul"] = "Split Soul",
        ["soulstrike"] = "Soul Strike",
        ["abyssalarmourspikesalloy"] = "Abyssal armour spikes (alloy)",
        ["armourspikealloy"] = "Armour spikes (alloy)",
        ["abyssalscourge"] = "Abyssal scourge",
        ["cinderbanes"] = "Cinderbane gloves",
        ["glovesofpassage"] = "Gloves of passage",
        ["jawsoftheabyss"] = "Jaws of the Abyss",
        ["kwuarmsticks"] = "Kwuarm incense sticks",
        ["dragonclaw"] = "Dragon claws",
        ["dragondagger"] = "Dragon dagger",
        ["dba"] = "Dragon battleaxe",
        ["ezk"] = "Ek-ZekKil",
        ["lengmh"] = "Dark Shard of Leng",
        ["callfollower"] = "Call follower"
    };

    private static readonly Dictionary<string, string> AbilityAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["anti"] = "Anticipation",
        ["anticipation"] = "Anticipation",
        ["cade"] = "Barricade",
        ["barricade"] = "Barricade",
        ["res"] = "Resonance",
        ["resonance"] = "Resonance",
        ["debil"] = "Debilitate",
        ["debilitate"] = "Debilitate",
        ["devo"] = "Devotion",
        ["devotion"] = "Devotion",
        ["freedom"] = "Freedom",
        ["reflect"] = "Reflect",
        ["immort"] = "Immortality",
        ["immortality"] = "Immortality",
        ["prep"] = "Preparation",
        ["voke"] = "Provoke"
    };

    private static readonly Dictionary<string, string> PerkAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["clearheaded"] = "Clear Headed",
        ["turtling"] = "Turtling",
        ["reflexes"] = "Reflexes",
        ["plantedfeet"] = "Planted Feet",
        ["caroming"] = "Caroming",
        ["flanking"] = "Flanking",
        ["lunging"] = "Lunging",
        ["invigorating"] = "Invigorating"
    };

    [GeneratedRegex(@"\|\s*image\s*=\s*(?<file>[^\r\n|}]+)", RegexOptions.IgnoreCase | RegexOptions.Compiled)]
    private static partial Regex InfoboxImageRegex();

    public WikiIconService(AppStorage storage, HttpMessageHandler? handler = null)
    {
        this.storage = storage;
        http = handler is null ? new HttpClient() : new HttpClient(handler);
        http.Timeout = TimeSpan.FromSeconds(12);
        http.DefaultRequestHeaders.UserAgent.ParseAdd("DungeonsAbilityTracker/1.0 (local desktop application)");
        http.DefaultRequestHeaders.TryAddWithoutValidation("Api-User-Agent", "DungeonsAbilityTracker/1.0 (local desktop application)");
    }

    public async Task<IReadOnlyList<WikiIconCandidate>> SearchAsync(TokenDefinition token, CancellationToken cancellationToken = default)
    {
        var query = GetPrimaryQuery(token);
        var direct = await SearchPagesAsync(query, token.DisplayName, cancellationToken);

        if (direct.All(candidate => candidate.PageKind != WikiPageKind.Ability))
        {
            var composite = await TryResolveCompositeAsync(token.Id, cancellationToken);
            if (composite is not null) direct.Insert(0, composite);
        }

        return direct
            .Where(candidate => !string.IsNullOrWhiteSpace(candidate.IconUrl))
            .OrderBy(candidate => candidate.PageKind == WikiPageKind.Ability ? 0 : candidate.PageKind == WikiPageKind.Item ? 1 : 2)
            .ThenByDescending(candidate => candidate.IsComposite)
            .ThenByDescending(candidate => candidate.Confidence)
            .ToList();
    }

    public async Task<WikiIconCandidate?> ResolveBestAsync(TokenDefinition token, CancellationToken cancellationToken = default)
    {
        var query = GetPrimaryQuery(token);
        var direct = await ResolvePageAsync(query, cancellationToken);
        if (direct is { PageKind: WikiPageKind.Ability or WikiPageKind.Item } && !string.IsNullOrWhiteSpace(direct.IconUrl))
        {
            direct.Confidence = 0.99;
            return direct;
        }

        var composite = await TryResolveCompositeAsync(token.Id, cancellationToken);
        if (composite is not null) return composite;

        // A PvME import carries the exact source emoji. If its compact name is not an exact
        // Wiki page, prefer that reliable icon over a broad and often ambiguous Wiki search.
        if (!string.IsNullOrWhiteSpace(token.SourceIconUrl)) return null;

        var candidates = await SearchAsync(token, cancellationToken);
        return candidates.FirstOrDefault(candidate => candidate.PageKind == WikiPageKind.Ability)
               ?? candidates.FirstOrDefault(candidate => candidate.PageKind == WikiPageKind.Item)
               ?? candidates.FirstOrDefault();
    }

    public async Task<string> CacheAsync(WikiIconCandidate candidate, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(candidate.IconUrl)) throw new InvalidOperationException("The selected Wiki page has no usable icon.");
        var key = string.IsNullOrWhiteSpace(candidate.FileSha1) ? HashUrl(candidate.IconUrl) : candidate.FileSha1;
        return await CacheUrlAsync(candidate.IconUrl, key, cancellationToken);
    }

    public async Task ApplySourceIconAsync(TokenDefinition token, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(token.SourceIconUrl))
            throw new InvalidOperationException("This token has no source icon.");
        token.WikiTitle = string.Empty;
        token.WikiIconUrl = string.Empty;
        token.WikiDescriptionUrl = string.Empty;
        token.WikiPageKind = WikiPageKind.Other;
        token.WikiModifiers.Clear();
        token.CachedIconFile = await CacheUrlAsync(token.SourceIconUrl, "pvme-" + HashUrl(token.SourceIconUrl), cancellationToken);
        token.IconConfirmed = true;
    }

    public async Task ApplyCandidateAsync(TokenDefinition token, WikiIconCandidate candidate, bool confirmed, CancellationToken cancellationToken = default)
    {
        token.WikiTitle = candidate.Title;
        token.WikiIconUrl = candidate.IconUrl;
        token.WikiDescriptionUrl = candidate.DescriptionUrl;
        token.WikiPageKind = candidate.PageKind;
        token.WikiModifiers = candidate.Modifiers.ToList();
        token.CachedIconFile = await CacheAsync(candidate, cancellationToken);
        token.IconConfirmed = confirmed;
    }

    private async Task<List<WikiIconCandidate>> SearchPagesAsync(string query, string displayName, CancellationToken cancellationToken)
    {
        var uri = ApiBase + "?action=opensearch&format=json&namespace=0&limit=8&search=" + Uri.EscapeDataString(query);
        using var json = await GetJsonAsync(uri, cancellationToken);
        if (json.RootElement.ValueKind != JsonValueKind.Array || json.RootElement.GetArrayLength() < 2) return [];
        var titles = json.RootElement[1].EnumerateArray().Select(item => item.GetString())
            .Where(value => !string.IsNullOrWhiteSpace(value)).Cast<string>();
        var result = new List<WikiIconCandidate>();
        var index = 0;
        foreach (var title in titles)
        {
            var candidate = await ResolvePageAsync(title, cancellationToken);
            if (candidate is not null)
            {
                var lexicalConfidence = Comparable(candidate.Title) == Comparable(query) ? 0.98 :
                    Comparable(candidate.Title) == Comparable(displayName) ? 0.95 : Math.Max(0.35, 0.75 - index * 0.08);
                candidate.Confidence = candidate.PageKind switch
                {
                    WikiPageKind.Ability => lexicalConfidence,
                    WikiPageKind.Item => Math.Min(0.94, lexicalConfidence),
                    WikiPageKind.Perk => Math.Min(0.55, lexicalConfidence),
                    _ => Math.Min(0.45, lexicalConfidence)
                };
                result.Add(candidate);
            }
            index++;
        }
        return result;
    }

    private async Task<WikiIconCandidate?> TryResolveCompositeAsync(string tokenId, CancellationToken cancellationToken)
    {
        var plan = TryCreateCompositePlan(tokenId);
        if (plan is null) return null;
        var ability = await ResolvePageAsync(plan.AbilityTitle, cancellationToken);
        if (ability is null || ability.PageKind != WikiPageKind.Ability || string.IsNullOrWhiteSpace(ability.IconUrl)) return null;

        var confirmedModifiers = new List<string>();
        foreach (var modifier in plan.Modifiers)
        {
            var modifierPage = await ResolvePageAsync(modifier.LookupTitle, cancellationToken);
            if (modifierPage?.PageKind == WikiPageKind.Perk) confirmedModifiers.Add(modifier.DisplayTitle);
        }
        if (confirmedModifiers.Count == 0) return null;
        ability.Modifiers = confirmedModifiers;
        ability.IsComposite = true;
        ability.Confidence = 0.99;
        return ability;
    }

    public static CompositeWikiPlan? TryCreateCompositePlan(string tokenId)
    {
        var normalized = Comparable(RotationParser.NormalizeToken(tokenId));
        foreach (var abilityAlias in AbilityAliases.OrderByDescending(pair => pair.Key.Length))
        {
            string remainder;
            if (normalized.StartsWith(abilityAlias.Key, StringComparison.OrdinalIgnoreCase))
                remainder = normalized[abilityAlias.Key.Length..];
            else if (normalized.EndsWith(abilityAlias.Key, StringComparison.OrdinalIgnoreCase))
                remainder = normalized[..^abilityAlias.Key.Length];
            else continue;

            if (string.IsNullOrWhiteSpace(remainder)) continue;
            var rank = Regex.Match(remainder, @"(?<rank>\d+)$").Groups["rank"].Value;
            var perkKey = Regex.Replace(remainder, @"\d+$", string.Empty);
            if (!PerkAliases.TryGetValue(perkKey, out var perkTitle)) continue;
            var display = string.IsNullOrWhiteSpace(rank) ? perkTitle : perkTitle + " " + rank;
            return new CompositeWikiPlan(abilityAlias.Value, [new CompositeWikiModifier(perkTitle, display)]);
        }
        return null;
    }

    public static WikiPageKind ClassifyWikitext(string wikitext)
    {
        if (Regex.IsMatch(wikitext, @"\{\{\s*Infobox\s+Ability\b", RegexOptions.IgnoreCase)) return WikiPageKind.Ability;
        if (Regex.IsMatch(wikitext, @"\{\{\s*Infobox\s+Perk\b", RegexOptions.IgnoreCase)) return WikiPageKind.Perk;
        if (Regex.IsMatch(wikitext, @"\{\{\s*Infobox\s+(Item|Weapon|Armour)\b", RegexOptions.IgnoreCase)) return WikiPageKind.Item;
        return WikiPageKind.Other;
    }

    private async Task<WikiIconCandidate?> ResolvePageAsync(string title, CancellationToken cancellationToken)
    {
        var parseUri = ApiBase + "?action=parse&format=json&formatversion=2&prop=wikitext&page=" + Uri.EscapeDataString(title);
        using var parseJson = await GetJsonAsync(parseUri, cancellationToken);
        if (!parseJson.RootElement.TryGetProperty("parse", out var parse) || !parse.TryGetProperty("wikitext", out var wikitextElement)) return null;
        var wikitext = wikitextElement.GetString() ?? string.Empty;
        var candidate = new WikiIconCandidate
        {
            Title = title,
            PageKind = ClassifyWikitext(wikitext),
            DescriptionUrl = "https://runescape.wiki/w/" + Uri.EscapeDataString(title.Replace(' ', '_'))
        };

        var imageMatch = InfoboxImageRegex().Match(wikitext);
        var fileName = imageMatch.Success ? imageMatch.Groups["file"].Value.Trim() : title + ".png";
        fileName = Regex.Replace(fileName, @"\{\{.*?\}\}", string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(fileName)) return candidate;
        candidate.FileName = fileName;

        var imageUri = ApiBase + "?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=url%7Csha1%7Csize&titles=" +
                       Uri.EscapeDataString("File:" + fileName);
        using var imageJson = await GetJsonAsync(imageUri, cancellationToken);
        if (!imageJson.RootElement.TryGetProperty("query", out var query) ||
            !query.TryGetProperty("pages", out var pages) || pages.GetArrayLength() == 0) return candidate;
        var page = pages[0];
        if (!page.TryGetProperty("imageinfo", out var infoArray) || infoArray.GetArrayLength() == 0) return candidate;
        var info = infoArray[0];
        candidate.IconUrl = info.GetProperty("url").GetString() ?? string.Empty;
        candidate.DescriptionUrl = info.TryGetProperty("descriptionurl", out var description) ? description.GetString() ?? candidate.DescriptionUrl : candidate.DescriptionUrl;
        candidate.FileSha1 = info.TryGetProperty("sha1", out var sha1) ? sha1.GetString() ?? Guid.NewGuid().ToString("N") : Guid.NewGuid().ToString("N");
        candidate.Width = info.TryGetProperty("width", out var width) ? width.GetInt32() : 0;
        candidate.Height = info.TryGetProperty("height", out var height) ? height.GetInt32() : 0;
        return candidate;
    }

    private async Task<JsonDocument> GetJsonAsync(string uri, CancellationToken cancellationToken)
    {
        using var response = await http.GetAsync(uri, cancellationToken);
        response.EnsureSuccessStatusCode();
        return JsonDocument.Parse(await response.Content.ReadAsStreamAsync(cancellationToken));
    }

    public void Dispose() => http.Dispose();
    private static string GetPrimaryQuery(TokenDefinition token) =>
        SearchAliases.TryGetValue(token.Id, out var alias) ? alias : token.DisplayName;

    private async Task<string> CacheUrlAsync(string url, string key, CancellationToken cancellationToken)
    {
        var extension = Path.GetExtension(new Uri(url).AbsolutePath);
        if (string.IsNullOrWhiteSpace(extension) || extension.Length > 5) extension = ".png";
        var path = Path.Combine(storage.IconCacheDirectory, key + extension);
        if (!File.Exists(path))
        {
            var bytes = await http.GetByteArrayAsync(url, cancellationToken);
            try { await File.WriteAllBytesAsync(path, bytes, cancellationToken); }
            catch (IOException) when (File.Exists(path)) { }
        }
        return path;
    }

    private static string HashUrl(string url) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(url))).ToLowerInvariant();
    private static string Comparable(string value) => new(value.Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray());
}

public sealed record CompositeWikiPlan(string AbilityTitle, IReadOnlyList<CompositeWikiModifier> Modifiers);
public sealed record CompositeWikiModifier(string LookupTitle, string DisplayTitle);

public sealed class WikiIconCandidate
{
    public string Title { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public string IconUrl { get; set; } = string.Empty;
    public string DescriptionUrl { get; set; } = string.Empty;
    public string FileSha1 { get; set; } = string.Empty;
    public WikiPageKind PageKind { get; set; } = WikiPageKind.Other;
    public List<string> Modifiers { get; set; } = [];
    public bool IsComposite { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public double Confidence { get; set; }
    public override string ToString()
    {
        var modifiers = Modifiers.Count == 0 ? string.Empty : " + " + string.Join(" + ", Modifiers);
        return $"{Title}{modifiers} [{PageKind}] ({Confidence:P0})";
    }
}
