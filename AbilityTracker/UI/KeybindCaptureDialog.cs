using AbilityTracker.Detection;

namespace AbilityTracker.UI;

public sealed class KeybindCaptureDialog : Form
{
    private readonly Label instruction = new()
    {
        Dock = DockStyle.Fill,
        TextAlign = ContentAlignment.MiddleCenter,
        Font = new Font("Segoe UI", 12, FontStyle.Bold),
        Text = "Press the RuneScape keybind now…\n\nEsc cancels"
    };

    public KeybindCaptureDialog(string tokenName)
    {
        Text = "Capture keybind — " + tokenName;
        Width = 430;
        Height = 210;
        StartPosition = FormStartPosition.CenterParent;
        MinimizeBox = MaximizeBox = false;
        KeyPreview = true;
        Controls.Add(instruction);
        KeyDown += OnKeyDown;
    }

    public string Gesture { get; private set; } = string.Empty;

    private void OnKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.KeyCode == Keys.Escape) { DialogResult = DialogResult.Cancel; Close(); return; }
        if (e.KeyCode is Keys.ControlKey or Keys.ShiftKey or Keys.Menu) return;
        var parts = new List<string>();
        if (e.Control) parts.Add("Ctrl");
        if (e.Alt) parts.Add("Alt");
        if (e.Shift) parts.Add("Shift");
        parts.Add(e.KeyCode.ToString());
        Gesture = InputMonitor.KeyGesture.Normalize(string.Join("+", parts));
        instruction.Text = Gesture;
        DialogResult = DialogResult.OK;
        Close();
    }
}
