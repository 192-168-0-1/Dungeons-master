using System.Text.RegularExpressions;
using AbilityTracker.Domain;

namespace AbilityTracker.Import;

public sealed partial class RotationParser
{
    [GeneratedRegex(@":[A-Za-z0-9_-]+:", RegexOptions.Compiled)]
    private static partial Regex TokenRegex();

    [GeneratedRegex(@"^(?<op>>=|<=|>|<)\s*(?<value>\d+)\s*%?\s*(?:adren(?:aline)?)?\s*:\s*(?<body>.*)$", RegexOptions.IgnoreCase | RegexOptions.Compiled)]
    private static partial Regex ConditionRegex();

    [GeneratedRegex(@"\((?<inner>[^()]*)\)", RegexOptions.Compiled)]
    private static partial Regex ParenthesesRegex();

    public RotationDocument Parse(string source, string? name = null)
    {
        var document = new RotationDocument
        {
            Name = string.IsNullOrWhiteSpace(name) ? "Imported rotation" : name.Trim(),
            SourceText = source ?? string.Empty
        };

        var current = new RotationSection { Name = "Rotation" };
        document.Sections.Add(current);

        var lines = (source ?? string.Empty).Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        foreach (var rawLine in lines)
        {
            var line = rawLine.Trim();
            if (string.IsNullOrWhiteSpace(line)) continue;

            if (IsHeading(line))
            {
                if (current.Entries.Count == 0 && current.Name == "Rotation")
                    current.Name = CleanHeading(line);
                else
                {
                    current = new RotationSection { Name = CleanHeading(line) };
                    document.Sections.Add(current);
                }
                continue;
            }

            var condition = ConditionRegex().Match(TrimBullet(line));
            if (condition.Success)
            {
                var branch = current.Entries.LastOrDefault()?.Branch;
                if (branch is null)
                {
                    branch = new RotationBranch();
                    current.Entries.Add(RotationEntry.FromBranch(branch));
                }

                branch.Options.Add(new BranchOption
                {
                    Condition = new AdrenalineCondition
                    {
                        Operator = condition.Groups["op"].Value,
                        Percentage = int.Parse(condition.Groups["value"].Value)
                    },
                    Steps = ParseSequence(condition.Groups["body"].Value, document)
                });
                continue;
            }

            if (LooksLikeSequence(line))
            {
                foreach (var step in ParseSequence(TrimBullet(line), document))
                    current.Entries.Add(RotationEntry.FromStep(step));
            }
            else
            {
                current.Entries.Add(RotationEntry.FromNote(TrimBullet(line)));
                RegisterTokens(line, document);
            }
        }

        document.Sections.RemoveAll(section => section.Entries.Count == 0 && document.Sections.Count > 1);
        return document;
    }

    private static List<RotationStep> ParseSequence(string value, RotationDocument document)
    {
        var segments = Regex.Split(value, @"\s*(?:→|->|⇒)\s*")
            .Where(segment => !string.IsNullOrWhiteSpace(segment));
        var result = new List<RotationStep>();
        foreach (var segment in segments)
        {
            var step = ParseStep(segment.Trim(), document);
            if (step.Actions.Count > 0 || !string.IsNullOrWhiteSpace(step.Cue)) result.Add(step);
        }
        return result;
    }

    private static RotationStep ParseStep(string segment, RotationDocument document)
    {
        var step = new RotationStep();
        var claimedTokens = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (Match groupMatch in ParenthesesRegex().Matches(segment))
        {
            var groupTokens = ExtractTokens(groupMatch.Groups["inner"].Value).ToList();
            if (groupTokens.Count == 0) continue;
            step.Actions.Add(new ActionRequirement { Alternatives = groupTokens, IsOptional = true });
            foreach (var token in groupTokens) claimedTokens.Add(token);
        }

        foreach (var token in ExtractTokens(segment))
        {
            if (claimedTokens.Contains(token)) continue;
            step.Actions.Add(new ActionRequirement { Alternatives = [token] });
        }

        foreach (var token in step.AllTokens) EnsureToken(document, token);
        step.IsOptional = step.Actions.Count > 0 && step.Actions.All(action => action.IsOptional);

        var cue = TokenRegex().Replace(segment, string.Empty);
        cue = Regex.Replace(cue, @"[+/]", " ");
        cue = Regex.Replace(cue, @"\s+", " ").Trim(' ', '(', ')', '-', '–');
        step.Cue = cue;
        return step;
    }

    private static IEnumerable<string> ExtractTokens(string value)
    {
        return TokenRegex().Matches(value)
            .Select(match => NormalizeToken(match.Value));
    }

    private static void RegisterTokens(string line, RotationDocument document)
    {
        foreach (var token in ExtractTokens(line)) EnsureToken(document, token);
    }

    private static void EnsureToken(RotationDocument document, string token)
    {
        if (document.Tokens.ContainsKey(token)) return;
        document.Tokens[token] = new TokenDefinition
        {
            Id = token,
            DisplayName = HumanizeToken(token),
            Kind = TokenKind.Trackable
        };
    }

    public static string NormalizeToken(string value)
    {
        return value.Trim().Trim(':').Replace(' ', '_').ToLowerInvariant();
    }

    public static string HumanizeToken(string value)
    {
        var normalized = NormalizeToken(value).Replace('_', ' ').Replace('-', ' ');
        normalized = Regex.Replace(normalized, "([a-z])([A-Z])", "$1 $2");
        if (normalized.Length == 0) return value;
        return string.Join(" ", normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(word => char.ToUpperInvariant(word[0]) + word[1..]));
    }

    private static bool LooksLikeSequence(string line)
    {
        var trimmed = TrimBullet(line);
        if (!TokenRegex().IsMatch(trimmed)) return false;
        if (trimmed.Contains('→') || trimmed.Contains("->", StringComparison.Ordinal)) return true;
        return !line.StartsWith('•') && !line.StartsWith('⬥') && !line.StartsWith('-');
    }

    private static bool IsHeading(string line)
    {
        var trimmed = TrimBullet(line);
        if (TokenRegex().IsMatch(trimmed) || trimmed.Contains('→') || ConditionRegex().IsMatch(trimmed)) return false;
        if (line.StartsWith('•') || line.StartsWith('⬥') || line.StartsWith('-')) return false;
        if (trimmed.EndsWith('.') || trimmed.Length > 60) return false;
        return Regex.IsMatch(trimmed, @"^(phase\s+\d+|font\s+\d+|drop\s*down|stage\s+\d+|p\d+|[A-Z][A-Za-z0-9 '’-]{0,35})$", RegexOptions.IgnoreCase);
    }

    private static string CleanHeading(string line) => TrimBullet(line).TrimEnd(':');
    private static string TrimBullet(string line) => line.TrimStart('•', '⬥', '-', ' ', '\t');
}
