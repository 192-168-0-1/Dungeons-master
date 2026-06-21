using AbilityTracker.Services;

namespace AbilityTracker.UI;

public sealed class WikiCandidateDialog : Form
{
    private readonly WikiIconService service;
    private readonly ListBox list = new() { Dock = DockStyle.Left, Width = 240 };
    private readonly PictureBox preview = new() { Dock = DockStyle.Fill, SizeMode = PictureBoxSizeMode.Zoom, BackColor = Color.FromArgb(30, 30, 32) };
    private readonly Label source = new() { Dock = DockStyle.Bottom, Height = 44, AutoEllipsis = true, ForeColor = Color.DimGray };

    public WikiCandidateDialog(WikiIconService service, IReadOnlyList<WikiIconCandidate> candidates)
    {
        this.service = service;
        Text = "Confirm RuneScape Wiki icon";
        Width = 620;
        Height = 390;
        StartPosition = FormStartPosition.CenterParent;
        MinimizeBox = MaximizeBox = false;
        list.Items.AddRange(candidates.Cast<object>().ToArray());
        list.SelectedIndexChanged += async (_, _) => await UpdatePreviewAsync();

        var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 42, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(6) };
        var ok = new Button { Text = "Use this icon", DialogResult = DialogResult.OK, AutoSize = true };
        var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, AutoSize = true };
        buttons.Controls.Add(ok);
        buttons.Controls.Add(cancel);
        Controls.Add(preview);
        Controls.Add(source);
        Controls.Add(list);
        Controls.Add(buttons);
        AcceptButton = ok;
        CancelButton = cancel;
        if (list.Items.Count > 0) list.SelectedIndex = 0;
    }

    public WikiIconCandidate? SelectedCandidate => list.SelectedItem as WikiIconCandidate;

    private async Task UpdatePreviewAsync()
    {
        if (SelectedCandidate is not { } candidate) return;
        try
        {
            var path = await service.CacheAsync(candidate);
            using var loaded = Image.FromFile(path);
            var clone = new Bitmap(loaded);
            var old = preview.Image;
            preview.Image = clone;
            old?.Dispose();
            source.Text = candidate.PageKind + " • " + candidate.DescriptionUrl;
        }
        catch (Exception exception)
        {
            source.Text = "Preview failed: " + exception.Message;
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) preview.Image?.Dispose();
        base.Dispose(disposing);
    }
}
