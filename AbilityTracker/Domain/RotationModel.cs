using System.Drawing;
using System.Text.Json.Serialization;

namespace AbilityTracker.Domain;

public sealed class RotationDocument
{
    public int Version { get; set; } = 3;
    public string Name { get; set; } = "New rotation";
    public string SourceText { get; set; } = string.Empty;
    public List<RotationSection> Sections { get; set; } = [];
    public Dictionary<string, TokenDefinition> Tokens { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public CalibrationProfile Calibration { get; set; } = new();
}

public sealed class RotationSection
{
    public string Name { get; set; } = "Rotation";
    public List<RotationEntry> Entries { get; set; } = [];
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum RotationEntryKind { Step, Note, Branch }

public sealed class RotationEntry
{
    public RotationEntryKind Kind { get; set; }
    public RotationStep? Step { get; set; }
    public RotationNote? Note { get; set; }
    public RotationBranch? Branch { get; set; }

    public static RotationEntry FromStep(RotationStep value) => new() { Kind = RotationEntryKind.Step, Step = value };
    public static RotationEntry FromNote(string value) => new() { Kind = RotationEntryKind.Note, Note = new RotationNote { Text = value } };
    public static RotationEntry FromBranch(RotationBranch value) => new() { Kind = RotationEntryKind.Branch, Branch = value };
}

public sealed class RotationNote
{
    public string Text { get; set; } = string.Empty;
}

public sealed class RotationStep
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public List<ActionRequirement> Actions { get; set; } = [];
    public string Cue { get; set; } = string.Empty;
    public bool IsOptional { get; set; }

    [JsonIgnore]
    public IEnumerable<string> AllTokens => Actions.SelectMany(action => action.Alternatives);

    public override string ToString()
    {
        var actionText = string.Join(" + ", Actions.Select(a => string.Join(" / ", a.Alternatives.Select(t => $":{t}:"))));
        return string.IsNullOrWhiteSpace(Cue) ? actionText : $"{Cue} {actionText}".Trim();
    }
}

public sealed class ActionRequirement
{
    public List<string> Alternatives { get; set; } = [];
    public bool IsOptional { get; set; }
}

public sealed class RotationBranch
{
    public string Label { get; set; } = "Adrenaline";
    public List<BranchOption> Options { get; set; } = [];
}

public sealed class BranchOption
{
    public AdrenalineCondition Condition { get; set; } = new();
    public List<RotationStep> Steps { get; set; } = [];
}

public sealed class AdrenalineCondition
{
    public string Operator { get; set; } = ">";
    public int Percentage { get; set; } = 50;

    public bool Matches(double value)
    {
        return Operator switch
        {
            ">" => value > Percentage,
            ">=" => value >= Percentage,
            "<" => value <= Percentage,
            "<=" => value <= Percentage,
            _ => false
        };
    }

    public override string ToString() => $"{Operator}{Percentage}% adrenaline";
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum TokenKind { Trackable, InputOnly, CueOnly }

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum WikiPageKind { Ability, Perk, Item, Other }

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum ConfirmationMode { CooldownOrActivation, AnyVisualChange, InputOnly, CueOnly }

public sealed class TokenDefinition
{
    public string Id { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public TokenKind Kind { get; set; } = TokenKind.Trackable;
    public string WikiTitle { get; set; } = string.Empty;
    public string WikiIconUrl { get; set; } = string.Empty;
    public string WikiDescriptionUrl { get; set; } = string.Empty;
    public WikiPageKind WikiPageKind { get; set; } = WikiPageKind.Other;
    public List<string> WikiModifiers { get; set; } = [];
    public string SourceIconUrl { get; set; } = string.Empty;
    public string SourceIconLabel { get; set; } = string.Empty;
    public string CachedIconFile { get; set; } = string.Empty;
    public bool IconConfirmed { get; set; }
    public TokenBinding Binding { get; set; } = new();
}

public sealed class TokenBinding
{
    public int SlotIndex { get; set; } = -1;
    public string KeyGesture { get; set; } = string.Empty;
    public double OcrConfidence { get; set; }
    public ConfirmationMode Confirmation { get; set; } = ConfirmationMode.CooldownOrActivation;
}

public sealed class CalibrationProfile
{
    public string Name { get; set; } = "Default";
    public int ClientWidth { get; set; }
    public int ClientHeight { get; set; }
    public bool UseScreenCapture { get; set; } = true;
    public List<SerializableRectangle> BarRegions { get; set; } = [];
    public List<CalibratedSlot> Slots { get; set; } = [];
    public SerializableRectangle AdrenalineRegion { get; set; } = new();
    public double VisualChangeThreshold { get; set; } = 0.12;
}

public sealed class CalibratedSlot
{
    public int Index { get; set; }
    public SerializableRectangle Region { get; set; } = new();
    public string ReadyTemplateFile { get; set; } = string.Empty;
    public string OcrText { get; set; } = string.Empty;
    public double OcrConfidence { get; set; }
}

public sealed class SerializableRectangle
{
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }

    [JsonIgnore]
    public bool IsEmpty => Width <= 0 || Height <= 0;

    public Rectangle ToRectangle() => new(X, Y, Width, Height);
    public static SerializableRectangle FromRectangle(Rectangle value) => new() { X = value.X, Y = value.Y, Width = value.Width, Height = value.Height };
}

public sealed class TrackerSettings
{
    public string LastRotationFile { get; set; } = string.Empty;
    public Point OverlayLocation { get; set; } = new(30, 30);
    public Size OverlaySize { get; set; } = new(570, 190);
    public bool OverlayClickThrough { get; set; } = true;
    public string StartPauseHotkey { get; set; } = "Ctrl+Shift+F8";
    public string ResetHotkey { get; set; } = "Ctrl+Shift+F9";
}
