using System.Drawing.Imaging;

namespace AbilityTracker.Detection;

public static class FrameAnalyzer
{
    public static Bitmap Crop(Bitmap source, Rectangle region)
    {
        var bounds = Rectangle.Intersect(new Rectangle(Point.Empty, source.Size), region);
        if (bounds.Width <= 0 || bounds.Height <= 0) return new Bitmap(1, 1);
        return source.Clone(bounds, PixelFormat.Format32bppArgb);
    }

    public static FrameSignature CreateSignature(Bitmap bitmap, int size = 16)
    {
        using var scaled = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (var graphics = Graphics.FromImage(scaled))
        {
            graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBilinear;
            graphics.DrawImage(bitmap, new Rectangle(0, 0, size, size));
        }

        var values = new byte[size * size];
        var data = scaled.LockBits(new Rectangle(0, 0, size, size), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        try
        {
            unsafe
            {
                var pointer = (byte*)data.Scan0;
                for (var y = 0; y < size; y++)
                for (var x = 0; x < size; x++)
                {
                    var pixel = pointer + y * data.Stride + x * 4;
                    values[y * size + x] = (byte)((pixel[2] * 77 + pixel[1] * 150 + pixel[0] * 29) >> 8);
                }
            }
        }
        finally { scaled.UnlockBits(data); }
        return new FrameSignature(values);
    }

    public static double Difference(FrameSignature first, FrameSignature second)
    {
        if (first.Values.Length != second.Values.Length || first.Values.Length == 0) return 1;
        long sum = 0;
        for (var index = 0; index < first.Values.Length; index++)
            sum += Math.Abs(first.Values[index] - second.Values[index]);
        return sum / (255.0 * first.Values.Length);
    }

    public static double IconSimilarity(Bitmap template, Bitmap slot)
    {
        using var templateCenter = CenterCrop(template);
        using var slotCenter = CenterCrop(slot);
        var a = CreateSignature(templateCenter, 24).Values;
        var b = CreateSignature(slotCenter, 24).Values;
        return Math.Max(Correlation(a, b), EdgeCorrelation(a, b));
    }

    private static Bitmap CenterCrop(Bitmap bitmap)
    {
        var size = Math.Max(1, (int)(Math.Min(bitmap.Width, bitmap.Height) * 0.72));
        return Crop(bitmap, new Rectangle((bitmap.Width - size) / 2, (bitmap.Height - size) / 2, size, size));
    }

    private static double Correlation(IReadOnlyList<byte> a, IReadOnlyList<byte> b)
    {
        var meanA = a.Average(value => (double)value);
        var meanB = b.Average(value => (double)value);
        double numerator = 0, denominatorA = 0, denominatorB = 0;
        for (var i = 0; i < a.Count; i++)
        {
            var da = a[i] - meanA;
            var db = b[i] - meanB;
            numerator += da * db;
            denominatorA += da * da;
            denominatorB += db * db;
        }
        var denominator = Math.Sqrt(denominatorA * denominatorB);
        return denominator <= 0 ? 0 : Math.Clamp((numerator / denominator + 1) / 2, 0, 1);
    }

    private static double EdgeCorrelation(IReadOnlyList<byte> a, IReadOnlyList<byte> b)
    {
        var edgeA = new byte[a.Count - 1];
        var edgeB = new byte[b.Count - 1];
        for (var i = 1; i < a.Count; i++)
        {
            edgeA[i - 1] = (byte)Math.Abs(a[i] - a[i - 1]);
            edgeB[i - 1] = (byte)Math.Abs(b[i] - b[i - 1]);
        }
        return Correlation(edgeA, edgeB);
    }
}

public readonly record struct FrameSignature(byte[] Values);
