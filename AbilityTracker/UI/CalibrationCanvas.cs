using AbilityTracker.Domain;

namespace AbilityTracker.UI;

public sealed class CalibrationCanvas : Control
{
    private Bitmap? image;
    private Point dragStart;
    private Point dragEnd;
    private bool dragging;

    public CalibrationCanvas()
    {
        DoubleBuffered = true;
        BackColor = Color.FromArgb(25, 25, 28);
        Cursor = Cursors.Cross;
    }

    public CalibrationSelectionMode SelectionMode { get; set; }
    public IReadOnlyList<SerializableRectangle> BarRegions { get; set; } = [];
    public IReadOnlyList<CalibratedSlot> Slots { get; set; } = [];
    public SerializableRectangle AdrenalineRegion { get; set; } = new();
    public event EventHandler<CalibrationSelectionEventArgs>? SelectionCompleted;

    public void SetImage(Bitmap? value)
    {
        image?.Dispose();
        image = value is null ? null : new Bitmap(value);
        Invalidate();
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (image is null || e.Button != MouseButtons.Left || SelectionMode == CalibrationSelectionMode.None) return;
        dragging = true;
        dragStart = dragEnd = e.Location;
        Capture = true;
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (!dragging) return;
        dragEnd = e.Location;
        Invalidate();
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (!dragging) return;
        dragging = false;
        Capture = false;
        dragEnd = e.Location;
        var display = Normalize(dragStart, dragEnd);
        var source = DisplayToImage(display);
        if (source.Width >= 5 && source.Height >= 5)
            SelectionCompleted?.Invoke(this, new CalibrationSelectionEventArgs(SelectionMode, source));
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        if (image is null)
        {
            TextRenderer.DrawText(e.Graphics, "Capture the RuneScape window, then drag around action bars and the adrenaline bar.",
                Font, ClientRectangle, Color.Silver, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.WordBreak);
            return;
        }

        var target = ImageDisplayRectangle();
        e.Graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBilinear;
        e.Graphics.DrawImage(image, target);

        using var barPen = new Pen(Color.DeepSkyBlue, 2);
        using var slotPen = new Pen(Color.FromArgb(180, Color.LimeGreen), 1);
        using var adrenalinePen = new Pen(Color.Gold, 2);
        foreach (var region in BarRegions) e.Graphics.DrawRectangle(barPen, ImageToDisplay(region.ToRectangle()));
        foreach (var slot in Slots) e.Graphics.DrawRectangle(slotPen, ImageToDisplay(slot.Region.ToRectangle()));
        if (!AdrenalineRegion.IsEmpty) e.Graphics.DrawRectangle(adrenalinePen, ImageToDisplay(AdrenalineRegion.ToRectangle()));

        if (dragging)
        {
            using var selectionPen = new Pen(SelectionMode == CalibrationSelectionMode.ActionBar ? Color.DeepSkyBlue : Color.Gold, 2) { DashStyle = System.Drawing.Drawing2D.DashStyle.Dash };
            e.Graphics.DrawRectangle(selectionPen, Normalize(dragStart, dragEnd));
        }
    }

    private Rectangle ImageDisplayRectangle()
    {
        if (image is null) return Rectangle.Empty;
        var scale = Math.Min(ClientSize.Width / (double)image.Width, ClientSize.Height / (double)image.Height);
        var size = new Size((int)Math.Round(image.Width * scale), (int)Math.Round(image.Height * scale));
        return new Rectangle((ClientSize.Width - size.Width) / 2, (ClientSize.Height - size.Height) / 2, size.Width, size.Height);
    }

    private Rectangle DisplayToImage(Rectangle display)
    {
        if (image is null) return Rectangle.Empty;
        var target = ImageDisplayRectangle();
        var clipped = Rectangle.Intersect(display, target);
        if (clipped.Width <= 0 || clipped.Height <= 0) return Rectangle.Empty;
        var scaleX = image.Width / (double)target.Width;
        var scaleY = image.Height / (double)target.Height;
        return Rectangle.FromLTRB(
            (int)Math.Round((clipped.Left - target.Left) * scaleX),
            (int)Math.Round((clipped.Top - target.Top) * scaleY),
            (int)Math.Round((clipped.Right - target.Left) * scaleX),
            (int)Math.Round((clipped.Bottom - target.Top) * scaleY));
    }

    private Rectangle ImageToDisplay(Rectangle source)
    {
        if (image is null) return Rectangle.Empty;
        var target = ImageDisplayRectangle();
        var scaleX = target.Width / (double)image.Width;
        var scaleY = target.Height / (double)image.Height;
        return Rectangle.FromLTRB(
            target.Left + (int)Math.Round(source.Left * scaleX), target.Top + (int)Math.Round(source.Top * scaleY),
            target.Left + (int)Math.Round(source.Right * scaleX), target.Top + (int)Math.Round(source.Bottom * scaleY));
    }

    private static Rectangle Normalize(Point first, Point second) => Rectangle.FromLTRB(
        Math.Min(first.X, second.X), Math.Min(first.Y, second.Y), Math.Max(first.X, second.X), Math.Max(first.Y, second.Y));

    protected override void Dispose(bool disposing)
    {
        if (disposing) image?.Dispose();
        base.Dispose(disposing);
    }
}

public enum CalibrationSelectionMode { None, ActionBar, Adrenaline }
public sealed class CalibrationSelectionEventArgs : EventArgs
{
    public CalibrationSelectionEventArgs(CalibrationSelectionMode mode, Rectangle region) { Mode = mode; Region = region; }
    public CalibrationSelectionMode Mode { get; }
    public Rectangle Region { get; }
}
