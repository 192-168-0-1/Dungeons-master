using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Text.RegularExpressions;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;

namespace AbilityTracker.Detection;

public sealed partial class KeybindOcrService
{
    [GeneratedRegex(@"[^A-Za-z0-9+\-]", RegexOptions.Compiled)]
    private static partial Regex InvalidCharacters();

    public async Task<OcrKeybindResult> ReadAsync(Bitmap slot, CancellationToken cancellationToken = default)
    {
        var results = new List<string>();
        foreach (var band in CreateBands(slot))
        {
            using (band)
            {
                foreach (var threshold in new[] { 90, 130, 170 })
                {
                    using var prepared = Prepare(band, threshold);
                    var text = await RecognizeAsync(prepared, cancellationToken);
                    var normalized = NormalizeGesture(text);
                    if (!string.IsNullOrWhiteSpace(normalized)) results.Add(normalized);
                }
            }
        }

        var best = results.GroupBy(value => value, StringComparer.OrdinalIgnoreCase)
            .OrderByDescending(group => group.Count())
            .ThenBy(group => group.Key.Length)
            .FirstOrDefault();
        if (best is null) return new OcrKeybindResult(string.Empty, 0);
        var confidence = Math.Min(1, best.Count() / 3.0);
        return new OcrKeybindResult(best.Key, confidence);
    }

    private static IEnumerable<Bitmap> CreateBands(Bitmap slot)
    {
        var height = Math.Max(5, slot.Height / 3);
        yield return FrameAnalyzer.Crop(slot, new Rectangle(0, 0, slot.Width, height));
        yield return FrameAnalyzer.Crop(slot, new Rectangle(0, slot.Height - height, slot.Width, height));
    }

    private static Bitmap Prepare(Bitmap source, int threshold)
    {
        const int scale = 6;
        var result = new Bitmap(source.Width * scale, source.Height * scale, PixelFormat.Format32bppArgb);
        using var graphics = Graphics.FromImage(result);
        graphics.InterpolationMode = InterpolationMode.NearestNeighbor;
        graphics.PixelOffsetMode = PixelOffsetMode.Half;
        graphics.DrawImage(source, new Rectangle(0, 0, result.Width, result.Height));
        for (var x = 0; x < result.Width; x++)
        for (var y = 0; y < result.Height; y++)
        {
            var color = result.GetPixel(x, y);
            var luminance = (color.R * 77 + color.G * 150 + color.B * 29) >> 8;
            result.SetPixel(x, y, luminance >= threshold ? Color.Black : Color.White);
        }
        return result;
    }

    private static async Task<string> RecognizeAsync(Bitmap bitmap, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        using var memory = new MemoryStream();
        bitmap.Save(memory, ImageFormat.Png);
        memory.Position = 0;
        using var randomAccess = memory.AsRandomAccessStream();
        var decoder = await BitmapDecoder.CreateAsync(randomAccess);
        using var softwareBitmap = await decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied);
        var engine = OcrEngine.TryCreateFromUserProfileLanguages();
        if (engine is null) return string.Empty;
        var result = await engine.RecognizeAsync(softwareBitmap);
        return result.Text;
    }

    public static string NormalizeGesture(string value)
    {
        var clean = InvalidCharacters().Replace(value ?? string.Empty, string.Empty).Trim('-', '+');
        if (clean.Length == 0 || clean.Length > 12) return string.Empty;
        clean = Regex.Replace(clean, "^(a|alt)-", "Alt+", RegexOptions.IgnoreCase);
        clean = Regex.Replace(clean, "^(c|ctrl)-", "Ctrl+", RegexOptions.IgnoreCase);
        clean = Regex.Replace(clean, "^(s|shift)-", "Shift+", RegexOptions.IgnoreCase);
        return clean;
    }
}

public readonly record struct OcrKeybindResult(string Gesture, double Confidence);
