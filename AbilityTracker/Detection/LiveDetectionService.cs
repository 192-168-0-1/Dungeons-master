using AbilityTracker.Domain;
using Dungeons.ScreenCapture;

namespace AbilityTracker.Detection;

public sealed class LiveDetectionService : IDisposable
{
    private readonly InputMonitor inputMonitor = new();
    private readonly AdrenalineReader adrenalineReader = new();
    private readonly Dictionary<int, FrameSignature> signatures = [];
    private readonly Dictionary<string, DateTime> lastDetected = new(StringComparer.OrdinalIgnoreCase);
    private readonly List<PendingInput> pending = [];
    private readonly object sync = new();
    private System.Threading.Timer? timer;
    private ProcessWindow? window;
    private RotationDocument? document;
    private int polling;

    public event EventHandler<ActionDetectedEventArgs>? ActionDetected;
    public event EventHandler<AdrenalineDetectedEventArgs>? AdrenalineDetected;
    public event EventHandler<string>? DiagnosticMessage;

    public LiveDetectionService()
    {
        inputMonitor.KeyPressed += OnKeyPressed;
        inputMonitor.MousePressed += OnMousePressed;
    }

    public void Start(ProcessWindow processWindow, RotationDocument rotation)
    {
        Stop();
        window = processWindow;
        document = rotation;
        signatures.Clear();
        lastDetected.Clear();
        lock (sync) pending.Clear();
        inputMonitor.Start(processWindow);
        timer = new System.Threading.Timer(_ => _ = PollAsync(), null, 0, 50);
    }

    public void Stop()
    {
        timer?.Dispose();
        timer = null;
        inputMonitor.Stop();
        window = null;
        document = null;
        signatures.Clear();
        lock (sync) pending.Clear();
    }

    private void OnKeyPressed(object? sender, KeyInputEventArgs e)
    {
        if (document is null) return;
        var gesture = InputMonitor.KeyGesture.Normalize(e.Gesture);
        var token = document.Tokens.Values.FirstOrDefault(candidate =>
            !string.IsNullOrWhiteSpace(candidate.Binding.KeyGesture) &&
            InputMonitor.KeyGesture.Normalize(candidate.Binding.KeyGesture).Equals(gesture, StringComparison.OrdinalIgnoreCase));
        if (token is null) return;
        QueueOrConfirm(token, e.Timestamp, "keyboard");
    }

    private void OnMousePressed(object? sender, MouseInputEventArgs e)
    {
        if (document is null || window is null) return;
        var clientOrigin = window.ClientToScreen(Point.Empty);
        var clientPoint = new Point(e.ScreenPoint.X - clientOrigin.X, e.ScreenPoint.Y - clientOrigin.Y);
        var slot = document.Calibration.Slots.FirstOrDefault(candidate => candidate.Region.ToRectangle().Contains(clientPoint));
        if (slot is null) return;
        var token = document.Tokens.Values.FirstOrDefault(candidate => candidate.Binding.SlotIndex == slot.Index);
        if (token is not null) QueueOrConfirm(token, e.Timestamp, "mouse");
    }

    private void QueueOrConfirm(TokenDefinition token, DateTime timestamp, string source)
    {
        if (token.Binding.Confirmation is ConfirmationMode.InputOnly or ConfirmationMode.CueOnly || token.Binding.SlotIndex < 0)
        {
            RaiseAction(token.Id, timestamp, source, 1);
            return;
        }

        signatures.TryGetValue(token.Binding.SlotIndex, out var baseline);
        lock (sync) pending.Add(new PendingInput(token, timestamp, source, baseline));
    }

    private async Task PollAsync()
    {
        if (Interlocked.Exchange(ref polling, 1) != 0) return;
        try
        {
            if (window is null || document is null || window.HasExited) return;
            var profile = document.Calibration;
            var regions = profile.Slots.Select(slot => slot.Region.ToRectangle())
                .Concat(profile.AdrenalineRegion.IsEmpty ? [] : [profile.AdrenalineRegion.ToRectangle()])
                .Where(region => region.Width > 0 && region.Height > 0).ToList();
            if (regions.Count == 0) return;
            var bounds = regions.Aggregate(Rectangle.Union);
            using var capture = window.Capture(bounds, profile.UseScreenCapture);
            if (capture is null) return;

            var changes = new Dictionary<int, double>();
            foreach (var slot in profile.Slots)
            {
                var local = slot.Region.ToRectangle();
                local.Offset(-bounds.X, -bounds.Y);
                using var crop = FrameAnalyzer.Crop(capture, local);
                var signature = FrameAnalyzer.CreateSignature(crop);
                if (signatures.TryGetValue(slot.Index, out var previous)) changes[slot.Index] = FrameAnalyzer.Difference(previous, signature);
                signatures[slot.Index] = signature;
            }

            if (!profile.AdrenalineRegion.IsEmpty)
            {
                var local = profile.AdrenalineRegion.ToRectangle();
                local.Offset(-bounds.X, -bounds.Y);
                using var crop = FrameAnalyzer.Crop(capture, local);
                var reading = adrenalineReader.Read(crop);
                AdrenalineDetected?.Invoke(this, new AdrenalineDetectedEventArgs(reading.Percentage, reading.Confidence));
            }

            ResolvePending(changes, profile.VisualChangeThreshold);
            DetectVisualOnly(changes, profile.VisualChangeThreshold);
            await Task.CompletedTask;
        }
        catch (Exception exception)
        {
            DiagnosticMessage?.Invoke(this, "Detection error: " + exception.Message);
        }
        finally { Volatile.Write(ref polling, 0); }
    }

    private void ResolvePending(IReadOnlyDictionary<int, double> changes, double threshold)
    {
        List<PendingInput> accepted = [];
        lock (sync)
        {
            var now = DateTime.UtcNow;
            foreach (var candidate in pending.ToList())
            {
                var expired = now - candidate.Timestamp > TimeSpan.FromMilliseconds(900);
                var currentChange = changes.TryGetValue(candidate.Token.Binding.SlotIndex, out var value) ? value : 0;
                var baselineChange = signatures.TryGetValue(candidate.Token.Binding.SlotIndex, out var current) && candidate.Baseline.Values is not null
                    ? FrameAnalyzer.Difference(candidate.Baseline, current) : currentChange;
                var score = Math.Max(currentChange, baselineChange);
                if (score >= threshold)
                {
                    accepted.Add(candidate with { Confidence = Math.Clamp(score / Math.Max(threshold, 0.01), 0, 1) });
                    pending.Remove(candidate);
                }
                else if (expired)
                {
                    DiagnosticMessage?.Invoke(this, $"Rejected {candidate.Token.DisplayName}: no visual confirmation.");
                    pending.Remove(candidate);
                }
            }
        }
        foreach (var candidate in accepted)
            RaiseAction(candidate.Token.Id, candidate.Timestamp, candidate.Source, candidate.Confidence);
    }

    private void DetectVisualOnly(IReadOnlyDictionary<int, double> changes, double threshold)
    {
        if (document is null || changes.Count == 0) return;
        lock (sync) if (pending.Count > 0) return;
        var ordered = changes.OrderByDescending(pair => pair.Value).Take(2).ToList();
        if (ordered[0].Value < threshold || ordered.Count > 1 && ordered[0].Value < ordered[1].Value * 1.35) return;
        var token = document.Tokens.Values.FirstOrDefault(candidate =>
            candidate.Binding.SlotIndex == ordered[0].Key && candidate.Binding.Confirmation != ConfirmationMode.InputOnly);
        if (token is not null)
            RaiseAction(token.Id, DateTime.UtcNow, "visual", ordered[0].Value);
    }

    private void RaiseAction(string token, DateTime timestamp, string source, double confidence)
    {
        if (lastDetected.TryGetValue(token, out var previous) && timestamp - previous < TimeSpan.FromMilliseconds(600)) return;
        lastDetected[token] = timestamp;
        ActionDetected?.Invoke(this, new ActionDetectedEventArgs(token, timestamp, source, confidence));
    }

    public void Dispose()
    {
        Stop();
        inputMonitor.Dispose();
    }

    private sealed record PendingInput(TokenDefinition Token, DateTime Timestamp, string Source, FrameSignature Baseline)
    {
        public double Confidence { get; init; }
    }
}

public sealed class ActionDetectedEventArgs : EventArgs
{
    public ActionDetectedEventArgs(string token, DateTime timestamp, string source, double confidence)
    {
        Token = token; Timestamp = timestamp; Source = source; Confidence = confidence;
    }
    public string Token { get; }
    public DateTime Timestamp { get; }
    public string Source { get; }
    public double Confidence { get; }
}

public sealed class AdrenalineDetectedEventArgs : EventArgs
{
    public AdrenalineDetectedEventArgs(double percentage, double confidence) { Percentage = percentage; Confidence = confidence; }
    public double Percentage { get; }
    public double Confidence { get; }
}
