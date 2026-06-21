using AbilityTracker.Services;

namespace AbilityTracker.UI;

public sealed class PvmeRotationDialog : Form
{
    private readonly ListBox rotations = new() { Dock = DockStyle.Left, Width = 300 };
    private readonly RichTextBox preview = new() { Dock = DockStyle.Fill, ReadOnly = true, Font = new Font("Consolas", 9), BackColor = Color.White };

    public PvmeRotationDialog(PvmeGuideImport import)
    {
        Text = $"Choose rotation — {import.ChannelName}";
        Width = 960;
        Height = 650;
        StartPosition = FormStartPosition.CenterParent;
        MinimizeBox = MaximizeBox = false;
        rotations.Items.AddRange(import.Rotations.Cast<object>().ToArray());
        rotations.SelectedIndexChanged += (_, _) => preview.Text = SelectedCandidate?.SourceText ?? string.Empty;

        var info = new Label
        {
            Dock = DockStyle.Top,
            Height = 42,
            Padding = new Padding(8),
            Text = $"This PvME channel contains {import.Rotations.Count} rotation(s). Choose which one to import."
        };
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 44, Padding = new Padding(6), FlowDirection = FlowDirection.RightToLeft };
        var importButton = new Button { Text = "Import selected", AutoSize = true, DialogResult = DialogResult.OK };
        var cancelButton = new Button { Text = "Cancel", AutoSize = true, DialogResult = DialogResult.Cancel };
        buttons.Controls.Add(importButton);
        buttons.Controls.Add(cancelButton);
        Controls.Add(preview);
        Controls.Add(rotations);
        Controls.Add(info);
        Controls.Add(buttons);
        AcceptButton = importButton;
        CancelButton = cancelButton;
        if (rotations.Items.Count > 0) rotations.SelectedIndex = 0;
    }

    public PvmeRotationCandidate? SelectedCandidate => rotations.SelectedItem as PvmeRotationCandidate;
}
