using System.Runtime.InteropServices;
using AbilityTracker.Domain;
using AbilityTracker.Tracking;
using Dungeons.ScreenCapture;

namespace AbilityTracker.UI;

public sealed class OverlayForm : Form
{
    private const int WsExTransparent = 0x20;
    private const int WsExToolWindow = 0x80;
    private const int WsExNoActivate = 0x08000000;
    private const int GwlExStyle = -20;
    private const int WmNclbuttondown = 0xA1;
    private const int HtCaption = 0x2;
    private readonly Dictionary<string, Image> imageCache = new(StringComparer.OrdinalIgnoreCase);
    private RotationDocument? document;
    private TrackerSnapshot snapshot = new();
    private bool clickThrough;

    public OverlayForm()
    {
        FormBorderStyle = FormBorderStyle.None;
        TopMost = true;
        ShowInTaskbar = false;
        BackColor = Color.FromArgb(24, 25, 28);
        Opacity = 0.92;
        DoubleBuffered = true;
        MinimumSize = new Size(420, 150);
        MouseDown += (_, e) =>
        {
            if (!clickThrough && e.Button == MouseButtons.Left)
            {
                ReleaseCapture();
                SendMessage(Handle, WmNclbuttondown, (IntPtr)HtCaption, IntPtr.Zero);
            }
        };
    }

    protected override bool ShowWithoutActivation => true;

    public void SetClickThrough(bool value)
    {
        clickThrough = value;
        if (!IsHandleCreated) return;
        var style = GetWindowLong(Handle, GwlExStyle);
        style |= WsExToolWindow | WsExNoActivate;
        if (value) style |= WsExTransparent; else style &= ~WsExTransparent;
        SetWindowLong(Handle, GwlExStyle, style);
    }

    public void UpdateState(RotationDocument rotation, TrackerSnapshot state)
    {
        document = rotation;
        snapshot = state;
        Invalidate();
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        WindowCapturePolicy.TryExclude(Handle);
        SetClickThrough(clickThrough);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.Clear(Color.FromArgb(24, 25, 28));
        using var headerFont = new Font("Segoe UI", 10, FontStyle.Bold);
        using var currentFont = new Font("Segoe UI", 13, FontStyle.Bold);
        using var nextFont = new Font("Segoe UI", 9);
        using var accentBrush = new SolidBrush(Color.FromArgb(95, 210, 255));
        using var textBrush = new SolidBrush(Color.WhiteSmoke);
        using var mutedBrush = new SolidBrush(Color.Silver);

        e.Graphics.DrawString(snapshot.SectionName, headerFont, accentBrush, 12, 8);
        e.Graphics.DrawString($"{snapshot.Adrenaline:0}%  •  {snapshot.Status}", nextFont, mutedBrush, 12, 30);
        if (snapshot.Current is null)
        {
            e.Graphics.DrawString("No current step", currentFont, textBrush, 12, 64);
            return;
        }

        var x = 12;
        const int imageSize = 48;
        foreach (var requirement in snapshot.Current.Actions)
        {
            for (var index = 0; index < requirement.Alternatives.Count; index++)
            {
                var token = requirement.Alternatives[index];
                var image = GetTokenImage(token);
                if (image is not null) e.Graphics.DrawImage(image, new Rectangle(x, 56, imageSize, imageSize));
                else
                {
                    using var fallback = new SolidBrush(Color.FromArgb(55, 58, 64));
                    e.Graphics.FillRectangle(fallback, x, 56, imageSize, imageSize);
                    TextRenderer.DrawText(e.Graphics, token[..Math.Min(4, token.Length)], nextFont, new Rectangle(x, 56, imageSize, imageSize),
                        Color.White, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
                }
                x += imageSize + 5;
                if (index < requirement.Alternatives.Count - 1)
                {
                    e.Graphics.DrawString("/", currentFont, mutedBrush, x, 68);
                    x += 16;
                }
            }
            x += 8;
        }
        e.Graphics.DrawString(snapshot.Current.Cue, nextFont, mutedBrush, 12, 108);

        var nextY = 128;
        foreach (var step in snapshot.Next)
        {
            var text = string.Join(" + ", step.Actions.Select(action => string.Join(" / ", action.Alternatives.Select(TokenName))));
            TextRenderer.DrawText(e.Graphics, "→ " + text, nextFont, new Rectangle(12, nextY, ClientSize.Width - 24, 20),
                Color.Gainsboro, TextFormatFlags.EndEllipsis | TextFormatFlags.VerticalCenter);
            nextY += 19;
        }
    }

    private string TokenName(string token)
    {
        return document is not null && document.Tokens.TryGetValue(token, out var definition) ? definition.DisplayName : token;
    }

    private Image? GetTokenImage(string token)
    {
        if (imageCache.TryGetValue(token, out var cached)) return cached;
        if (document is null || !document.Tokens.TryGetValue(token, out var definition)) return null;
        var path = definition.CachedIconFile;
        if (string.IsNullOrWhiteSpace(path) && definition.Binding.SlotIndex >= 0)
            path = document.Calibration.Slots.FirstOrDefault(slot => slot.Index == definition.Binding.SlotIndex)?.ReadyTemplateFile ?? string.Empty;
        if (!File.Exists(path)) return null;
        try
        {
            using var loaded = Image.FromFile(path);
            var image = new Bitmap(loaded);
            imageCache[token] = image;
            return image;
        }
        catch { return null; }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            foreach (var image in imageCache.Values) image.Dispose();
            imageCache.Clear();
        }
        base.Dispose(disposing);
    }

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();
    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowLong(IntPtr hWnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")]
    private static extern int SetWindowLong(IntPtr hWnd, int index, int value);
}
