using AbilityTracker.Detection;

namespace AbilityTracker.Tests;

[TestClass]
public sealed class DetectionTests
{
    [TestMethod]
    public void FrameSignaturesSeparateStableAndChangedSlots()
    {
        using var first = CreateIcon(Color.DarkRed, Color.White);
        using var same = CreateIcon(Color.DarkRed, Color.White);
        using var changed = CreateIcon(Color.Navy, Color.Gold);

        var stableDifference = FrameAnalyzer.Difference(FrameAnalyzer.CreateSignature(first), FrameAnalyzer.CreateSignature(same));
        var changedDifference = FrameAnalyzer.Difference(FrameAnalyzer.CreateSignature(first), FrameAnalyzer.CreateSignature(changed));
        Assert.AreEqual(0, stableDifference, 0.001);
        Assert.IsTrue(changedDifference > 0.1);
        Assert.IsTrue(FrameAnalyzer.IconSimilarity(first, same) > 0.95);
    }

    [TestMethod]
    public void SlotGridDetectsFourteenSquareActionBarCells()
    {
        var slots = SlotGridDetector.Detect(new Rectangle(100, 200, 504, 36));
        Assert.AreEqual(14, slots.Count);
        Assert.IsTrue(slots.All(slot => Math.Abs(slot.Region.Width - slot.Region.Height) <= 2));
    }

    [TestMethod]
    public void AdrenalineReaderMeasuresYellowFill()
    {
        using var bitmap = new Bitmap(200, 8);
        using (var graphics = Graphics.FromImage(bitmap))
        {
            graphics.Clear(Color.FromArgb(20, 20, 20));
            graphics.FillRectangle(Brushes.Gold, 0, 1, 100, 6);
        }
        var reading = new AdrenalineReader().Read(bitmap);
        Assert.AreEqual(50, reading.Percentage, 2);
        Assert.IsTrue(reading.Confidence > 0.5);
    }

    [TestMethod]
    public void KeybindNormalizerUnderstandsRuneScapeModifierLabels()
    {
        Assert.AreEqual("Alt+C", KeybindOcrService.NormalizeGesture("a-C"));
        Assert.AreEqual("Shift+F", KeybindOcrService.NormalizeGesture("s-F"));
        Assert.AreEqual("Ctrl+1", KeybindOcrService.NormalizeGesture("c-1"));
    }

    private static Bitmap CreateIcon(Color background, Color foreground)
    {
        var bitmap = new Bitmap(48, 48);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.Clear(background);
        using var pen = new Pen(foreground, 5);
        graphics.DrawEllipse(pen, 8, 8, 32, 32);
        graphics.DrawLine(pen, 10, 38, 38, 10);
        return bitmap;
    }
}
