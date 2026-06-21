using System.Text.Json;
using System.Text.Json.Serialization;
using AbilityTracker.Domain;

namespace AbilityTracker.Services;

public sealed class AppStorage
{
    private readonly JsonSerializerOptions jsonOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() }
    };

    public AppStorage(string? rootDirectory = null, string? localRootDirectory = null)
    {
        RootDirectory = rootDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "DungeonsAbilityTracker");
        RotationDirectory = Path.Combine(RootDirectory, "Rotations");
        ProfileDirectory = Path.Combine(RootDirectory, "Profiles");
        IconCacheDirectory = Path.Combine(localRootDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DungeonsAbilityTracker"), "IconCache");
        Directory.CreateDirectory(RotationDirectory);
        Directory.CreateDirectory(ProfileDirectory);
        Directory.CreateDirectory(IconCacheDirectory);
    }

    public string RootDirectory { get; }
    public string RotationDirectory { get; }
    public string ProfileDirectory { get; }
    public string IconCacheDirectory { get; }
    public string SettingsFile => Path.Combine(RootDirectory, "settings.json");

    public async Task<string> SaveRotationAsync(RotationDocument document, string? path = null)
    {
        path ??= Path.Combine(RotationDirectory, SanitizeFileName(document.Name) + ".json");
        await File.WriteAllTextAsync(path, JsonSerializer.Serialize(document, jsonOptions)).ConfigureAwait(false);
        return path;
    }

    public string SaveRotation(RotationDocument document, string? path = null)
    {
        path ??= Path.Combine(RotationDirectory, SanitizeFileName(document.Name) + ".json");
        File.WriteAllText(path, JsonSerializer.Serialize(document, jsonOptions));
        return path;
    }

    public async Task<RotationDocument?> LoadRotationAsync(string path)
    {
        if (!File.Exists(path)) return null;
        var document = JsonSerializer.Deserialize<RotationDocument>(await File.ReadAllTextAsync(path).ConfigureAwait(false), jsonOptions);
        if (document is not null && document.Version < 2)
        {
            foreach (var token in document.Tokens.Values)
            {
                if (!string.IsNullOrWhiteSpace(token.WikiTitle)) token.IconConfirmed = false;
                token.WikiPageKind = WikiPageKind.Other;
                token.WikiModifiers.Clear();
            }
        }
        if (document is not null && document.Version < 3) document.Version = 3;
        return document;
    }

    public async Task SaveSettingsAsync(TrackerSettings settings)
    {
        Directory.CreateDirectory(RootDirectory);
        await File.WriteAllTextAsync(SettingsFile, JsonSerializer.Serialize(settings, jsonOptions)).ConfigureAwait(false);
    }

    public void SaveSettings(TrackerSettings settings)
    {
        Directory.CreateDirectory(RootDirectory);
        File.WriteAllText(SettingsFile, JsonSerializer.Serialize(settings, jsonOptions));
    }

    public async Task<TrackerSettings> LoadSettingsAsync()
    {
        try
        {
            if (File.Exists(SettingsFile))
                return JsonSerializer.Deserialize<TrackerSettings>(await File.ReadAllTextAsync(SettingsFile).ConfigureAwait(false), jsonOptions) ?? new TrackerSettings();
        }
        catch (JsonException) { }
        return new TrackerSettings();
    }

    private static string SanitizeFileName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var result = new string(value.Select(c => invalid.Contains(c) ? '_' : c).ToArray()).Trim();
        return string.IsNullOrWhiteSpace(result) ? "rotation" : result;
    }
}
