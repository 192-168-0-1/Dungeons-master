using AbilityTracker.Domain;

namespace AbilityTracker.Tracking;

public sealed class RotationEngine
{
    private readonly RotationDocument document;
    private readonly List<TrackerHistoryItem> history = [];
    private List<RotationStep> activeSteps = [];
    private readonly Dictionary<Guid, HashSet<int>> completedRequirements = [];
    private int sectionIndex;
    private int stepIndex;
    private double adrenaline;

    public RotationEngine(RotationDocument document)
    {
        this.document = document;
        LoadSection(0, 0);
    }

    public bool IsRunning { get; private set; }
    public bool IsPaused { get; private set; }
    public bool IsInPhaseHandoff { get; private set; }
    public IReadOnlyList<TrackerHistoryItem> History => history;
    public event EventHandler? ProgressChanged;

    public void Start()
    {
        IsRunning = true;
        IsPaused = false;
        ProgressChanged?.Invoke(this, EventArgs.Empty);
    }

    public void TogglePause()
    {
        if (!IsRunning) Start();
        else IsPaused = !IsPaused;
        ProgressChanged?.Invoke(this, EventArgs.Empty);
    }

    public void Reset(double currentAdrenaline = 0)
    {
        history.Clear();
        completedRequirements.Clear();
        sectionIndex = 0;
        stepIndex = 0;
        adrenaline = currentAdrenaline;
        IsInPhaseHandoff = false;
        LoadSection(0, currentAdrenaline);
        ProgressChanged?.Invoke(this, EventArgs.Empty);
    }

    public void UpdateAdrenaline(double value)
    {
        adrenaline = Math.Clamp(value, 0, 100);
        ProgressChanged?.Invoke(this, EventArgs.Empty);
    }

    public DetectionOutcome RegisterAction(string rawToken, DateTime timestamp, double? currentAdrenaline = null, string source = "screen")
    {
        if (!IsRunning || IsPaused) return DetectionOutcome.Ignored;
        if (currentAdrenaline.HasValue) adrenaline = currentAdrenaline.Value;
        var token = Normalize(rawToken);

        if (IsInPhaseHandoff && sectionIndex + 1 < document.Sections.Count)
        {
            var nextSteps = BuildSectionSteps(sectionIndex + 1, adrenaline);
            var nextMatch = FindMatch(nextSteps, 0, token, 8);
            if (nextMatch >= 0)
            {
                sectionIndex++;
                activeSteps = nextSteps;
                stepIndex = nextMatch;
                IsInPhaseHandoff = false;
                AddSkippedBefore(nextMatch, timestamp, "phase handoff");
                var outcome = ApplyToCurrent(token, timestamp, source, true);
                ProgressChanged?.Invoke(this, EventArgs.Empty);
                return outcome;
            }

            AddHistory(timestamp, token, TrackerHistoryKind.Extra, source, "Extra filler during phase handoff");
            ProgressChanged?.Invoke(this, EventArgs.Empty);
            return DetectionOutcome.Extra;
        }

        if (stepIndex >= activeSteps.Count)
        {
            AddHistory(timestamp, token, TrackerHistoryKind.Extra, source, "Rotation complete");
            return DetectionOutcome.Extra;
        }

        if (StepContains(activeSteps[stepIndex], token))
        {
            var outcome = ApplyToCurrent(token, timestamp, source, false);
            ProgressChanged?.Invoke(this, EventArgs.Empty);
            return outcome;
        }

        var match = FindMatch(activeSteps, stepIndex + 1, token, 8);
        if (match >= 0)
        {
            for (var i = stepIndex; i < match; i++)
                AddHistory(timestamp, activeSteps[i].ToString(), TrackerHistoryKind.Skipped, source, "Automatic resync");
            stepIndex = match;
            var outcome = ApplyToCurrent(token, timestamp, source, true);
            ProgressChanged?.Invoke(this, EventArgs.Empty);
            return outcome;
        }

        AddHistory(timestamp, token, TrackerHistoryKind.Unexpected, source, "Not in the next eight steps");
        ProgressChanged?.Invoke(this, EventArgs.Empty);
        return DetectionOutcome.Unexpected;
    }

    public TrackerSnapshot GetSnapshot()
    {
        var section = document.Sections.Count == 0 ? string.Empty : document.Sections[Math.Min(sectionIndex, document.Sections.Count - 1)].Name;
        var upcoming = new List<RotationStep>();
        if (IsInPhaseHandoff && sectionIndex + 1 < document.Sections.Count)
            upcoming.AddRange(BuildSectionSteps(sectionIndex + 1, adrenaline).Take(4));
        else
            upcoming.AddRange(activeSteps.Skip(stepIndex).Take(4));

        return new TrackerSnapshot
        {
            SectionName = section,
            IsRunning = IsRunning,
            IsPaused = IsPaused,
            IsPhaseHandoff = IsInPhaseHandoff,
            Adrenaline = adrenaline,
            Current = upcoming.FirstOrDefault(),
            Next = upcoming.Skip(1).Take(3).ToList(),
            Status = IsPaused ? "Paused" : IsInPhaseHandoff ? "Phase handoff – waiting for next phase action" :
                     !IsRunning ? "Ready" : stepIndex >= activeSteps.Count ? "Complete" : "Tracking"
        };
    }

    private DetectionOutcome ApplyToCurrent(string token, DateTime timestamp, string source, bool resynced)
    {
        var step = activeSteps[stepIndex];
        if (!completedRequirements.TryGetValue(step.Id, out var completed))
        {
            completed = [];
            completedRequirements[step.Id] = completed;
        }

        for (var index = 0; index < step.Actions.Count; index++)
        {
            if (step.Actions[index].Alternatives.Any(candidate => Normalize(candidate) == token)) completed.Add(index);
        }

        AddHistory(timestamp, token, resynced ? TrackerHistoryKind.Resynced : TrackerHistoryKind.Confirmed, source,
            resynced ? "Matched a later step" : "Expected action");

        if (IsStepSatisfied(step, completed)) AdvanceStep();
        return resynced ? DetectionOutcome.Resynced : DetectionOutcome.Confirmed;
    }

    private void AdvanceStep()
    {
        stepIndex++;
        if (stepIndex < activeSteps.Count) return;
        if (sectionIndex + 1 < document.Sections.Count)
            IsInPhaseHandoff = true;
    }

    private void LoadSection(int index, double currentAdrenaline)
    {
        if (document.Sections.Count == 0)
        {
            activeSteps = [];
            return;
        }
        sectionIndex = Math.Clamp(index, 0, document.Sections.Count - 1);
        activeSteps = BuildSectionSteps(sectionIndex, currentAdrenaline);
        stepIndex = 0;
    }

    private List<RotationStep> BuildSectionSteps(int index, double currentAdrenaline)
    {
        if (index < 0 || index >= document.Sections.Count) return [];
        var result = new List<RotationStep>();
        foreach (var entry in document.Sections[index].Entries)
        {
            if (entry.Kind == RotationEntryKind.Step && entry.Step is not null) result.Add(entry.Step);
            else if (entry.Kind == RotationEntryKind.Branch && entry.Branch is not null)
            {
                var option = entry.Branch.Options.FirstOrDefault(candidate => candidate.Condition.Matches(currentAdrenaline))
                             ?? entry.Branch.Options.LastOrDefault();
                if (option is not null) result.AddRange(option.Steps);
            }
        }
        return result;
    }

    private void AddSkippedBefore(int match, DateTime timestamp, string reason)
    {
        for (var index = 0; index < match; index++)
            AddHistory(timestamp, activeSteps[index].ToString(), TrackerHistoryKind.Skipped, "engine", reason);
    }

    private static int FindMatch(IReadOnlyList<RotationStep> steps, int start, string token, int limit)
    {
        var end = Math.Min(steps.Count, start + limit);
        for (var index = start; index < end; index++)
            if (StepContains(steps[index], token)) return index;
        return -1;
    }

    private static bool StepContains(RotationStep step, string token)
    {
        return step.Actions.Any(action => action.Alternatives.Any(candidate => Normalize(candidate) == token));
    }

    private static bool IsStepSatisfied(RotationStep step, HashSet<int> completed)
    {
        var required = Enumerable.Range(0, step.Actions.Count).Where(i => !step.Actions[i].IsOptional).ToList();
        return required.Count > 0 ? required.All(completed.Contains) : completed.Count > 0;
    }

    private void AddHistory(DateTime timestamp, string token, TrackerHistoryKind kind, string source, string detail)
    {
        history.Add(new TrackerHistoryItem(timestamp, token, kind, source, detail));
        if (history.Count > 500) history.RemoveAt(0);
    }

    private static string Normalize(string token) => token.Trim().Trim(':').Replace(' ', '_').ToLowerInvariant();
}

public enum DetectionOutcome { Ignored, Confirmed, Resynced, Unexpected, Extra }
public enum TrackerHistoryKind { Confirmed, Resynced, Unexpected, Skipped, Extra }
public sealed record TrackerHistoryItem(DateTime Timestamp, string Token, TrackerHistoryKind Kind, string Source, string Detail);

public sealed class TrackerSnapshot
{
    public string SectionName { get; set; } = string.Empty;
    public bool IsRunning { get; set; }
    public bool IsPaused { get; set; }
    public bool IsPhaseHandoff { get; set; }
    public double Adrenaline { get; set; }
    public RotationStep? Current { get; set; }
    public List<RotationStep> Next { get; set; } = [];
    public string Status { get; set; } = string.Empty;
}
