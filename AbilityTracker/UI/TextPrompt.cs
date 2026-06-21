namespace AbilityTracker.UI;

internal static class TextPrompt
{
    public static string? Show(IWin32Window owner, string title, string label, string value)
    {
        using var form = new Form { Text = title, Width = 620, Height = 180, StartPosition = FormStartPosition.CenterParent, MinimizeBox = false, MaximizeBox = false };
        var caption = new Label { Text = label, Dock = DockStyle.Top, Height = 28, Padding = new Padding(8, 8, 0, 0) };
        var input = new TextBox { Text = value, Dock = DockStyle.Top, Margin = new Padding(8) };
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 44, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(6) };
        var ok = new Button { Text = "OK", DialogResult = DialogResult.OK };
        var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel };
        buttons.Controls.Add(ok); buttons.Controls.Add(cancel);
        form.Controls.Add(input); form.Controls.Add(caption); form.Controls.Add(buttons);
        form.AcceptButton = ok; form.CancelButton = cancel;
        return form.ShowDialog(owner) == DialogResult.OK ? input.Text : null;
    }
}
