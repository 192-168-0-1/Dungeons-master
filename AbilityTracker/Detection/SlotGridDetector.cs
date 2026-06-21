using AbilityTracker.Domain;

namespace AbilityTracker.Detection;

public static class SlotGridDetector
{
    public static IReadOnlyList<CalibratedSlot> Detect(Rectangle region, int firstIndex = 0)
    {
        if (region.Width < 20 || region.Height < 20) return [];

        var best = (Rows: 1, Columns: 1, CellWidth: region.Width, CellHeight: region.Height, Error: double.MaxValue);
        for (var rows = 1; rows <= Math.Min(8, region.Height / 20); rows++)
        for (var columns = 1; columns <= Math.Min(20, region.Width / 20); columns++)
        {
            var width = region.Width / (double)columns;
            var height = region.Height / (double)rows;
            if (width < 20 || width > 70 || height < 20 || height > 70) continue;
            var squareError = Math.Abs(width - height);
            var remainder = region.Width % columns + region.Height % rows;
            var commonSizePenalty = Math.Abs((width + height) / 2 - 36) * 0.08;
            var error = squareError + remainder * 0.2 + commonSizePenalty;
            if (error < best.Error) best = (rows, columns, (int)Math.Round(width), (int)Math.Round(height), error);
        }

        var result = new List<CalibratedSlot>();
        for (var row = 0; row < best.Rows; row++)
        for (var column = 0; column < best.Columns; column++)
        {
            var left = region.Left + (int)Math.Round(column * region.Width / (double)best.Columns);
            var top = region.Top + (int)Math.Round(row * region.Height / (double)best.Rows);
            var right = region.Left + (int)Math.Round((column + 1) * region.Width / (double)best.Columns);
            var bottom = region.Top + (int)Math.Round((row + 1) * region.Height / (double)best.Rows);
            var cell = Rectangle.FromLTRB(left + 1, top + 1, right - 1, bottom - 1);
            result.Add(new CalibratedSlot
            {
                Index = firstIndex + result.Count,
                Region = SerializableRectangle.FromRectangle(cell)
            });
        }
        return result;
    }
}
