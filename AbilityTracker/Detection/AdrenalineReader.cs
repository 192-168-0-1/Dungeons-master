namespace AbilityTracker.Detection;

public sealed class AdrenalineReader
{
    private readonly Queue<double> samples = new();

    public AdrenalineReading Read(Bitmap bitmap)
    {
        if (bitmap.Width < 4 || bitmap.Height < 2) return new AdrenalineReading(0, 0);
        var colored = new int[bitmap.Width];
        var candidatePixels = 0;
        for (var x = 0; x < bitmap.Width; x++)
        for (var y = 0; y < bitmap.Height; y++)
        {
            var color = bitmap.GetPixel(x, y);
            var max = Math.Max(color.R, Math.Max(color.G, color.B));
            var min = Math.Min(color.R, Math.Min(color.G, color.B));
            var saturation = max == 0 ? 0 : (max - min) / (double)max;
            var yellowOrCyan = color.R > color.B * 1.3 && color.G > color.B * 1.15 ||
                               color.G > color.R * 1.1 && color.B > color.R * 1.05;
            if (max > 95 && saturation > 0.25 && yellowOrCyan)
            {
                colored[x]++;
                candidatePixels++;
            }
        }

        var activeThreshold = Math.Max(1, bitmap.Height / 5);
        var lastActive = -1;
        for (var x = 0; x < colored.Length; x++) if (colored[x] >= activeThreshold) lastActive = x;
        var raw = lastActive < 0 ? 0 : (lastActive + 1) * 100.0 / bitmap.Width;
        var confidence = Math.Clamp(candidatePixels / (double)Math.Max(1, bitmap.Width * bitmap.Height / 5), 0, 1);

        samples.Enqueue(raw);
        while (samples.Count > 5) samples.Dequeue();
        return new AdrenalineReading(samples.Average(), confidence);
    }
}

public readonly record struct AdrenalineReading(double Percentage, double Confidence);
