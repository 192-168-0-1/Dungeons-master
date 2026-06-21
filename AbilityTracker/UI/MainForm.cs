using System.ComponentModel;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using AbilityTracker.Detection;
using AbilityTracker.Domain;
using AbilityTracker.Import;
using AbilityTracker.Services;
using AbilityTracker.Tracking;
using Dungeons.ScreenCapture;

namespace AbilityTracker.UI;

public sealed class MainForm : Form
{
    private const int WmHotkey = 0x0312;
    private readonly AppStorage storage = new();
    private readonly RotationParser parser = new();
    private readonly WikiIconService wiki;
    private readonly PvmeImportService pvme = new();
    private readonly KeybindOcrService ocr = new();
    private readonly LiveDetectionService detection = new();
    private readonly OverlayForm overlay = new();
    private readonly ComboBox processCombo = new() { Width = 300, DropDownStyle = ComboBoxStyle.DropDownList };
    private readonly TextBox rotationName = new() { Width = 210, Text = "Telos rotation" };
    private readonly TextBox pvmeLinkText = new() { Width = 420, PlaceholderText = "PvME Discord channel link…" };
    private readonly RichTextBox sourceText = new() { Dock = DockStyle.Fill, Font = new Font("Consolas", 9.5f), AcceptsTab = true };
    private readonly TreeView rotationTree = new() { Dock = DockStyle.Fill, HideSelection = false };
    private readonly DataGridView tokenGrid = new() { Dock = DockStyle.Fill, AllowUserToAddRows = false, AllowUserToDeleteRows = false, AutoSizeRowsMode = DataGridViewAutoSizeRowsMode.None };
    private readonly CalibrationCanvas calibrationCanvas = new() { Dock = DockStyle.Fill };
    private readonly Label calibrationStatus = new() { AutoSize = true, MaximumSize = new Size(260, 0), Text = "No client capture yet." };
    private readonly Label liveStatus = new() { AutoSize = true, Text = "Ready" };
    private readonly ListView historyList = new() { Dock = DockStyle.Fill, View = View.Details, FullRowSelect = true };
    private readonly ComboBox simulationToken = new() { Width = 190, DropDownStyle = ComboBoxStyle.DropDownList };
    private readonly CheckBox clickThroughCheck = new() { Text = "Overlay click-through", Checked = true, AutoSize = true };
    private readonly TextBox startHotkeyText = new() { Width = 125 };
    private readonly TextBox resetHotkeyText = new() { Width = 125 };
    private readonly Label applicationStatus = new() { AutoSize = true, Text = "Ready", ForeColor = Color.DimGray };
    private RotationDocument? document;
    private RotationEngine? engine;
    private TrackerSettings settings = new();
    private Bitmap? capturedClient;
    private string? currentRotationPath;
    private bool updatingTokenGrid;
    private bool shuttingDown;

    public MainForm()
    {
        wiki = new WikiIconService(storage);
        Text = "Ability Rotation Tracker";
        Width = 1220;
        Height = 820;
        MinimumSize = new Size(980, 680);
        StartPosition = FormStartPosition.CenterScreen;
        BuildUi();
        WireEvents();
    }

    private ProcessWindow? SelectedWindow => processCombo.SelectedItem as ProcessWindow;

    private void BuildUi()
    {
        var top = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 42, Padding = new Padding(6), WrapContents = false };
        top.Controls.Add(new Label { Text = "RuneScape:", AutoSize = true, Margin = new Padding(3, 7, 3, 0) });
        top.Controls.Add(processCombo);
        top.Controls.Add(MakeButton("Refresh", (_, _) => RefreshProcesses()));
        top.Controls.Add(MakeButton("Load rotation", async (_, _) => await LoadRotationFromDialogAsync()));
        top.Controls.Add(MakeButton("Save", async (_, _) => await SaveRotationAsync()));
        top.Controls.Add(applicationStatus);

        var tabs = new TabControl { Dock = DockStyle.Fill };
        tabs.TabPages.Add(BuildRotationTab());
        tabs.TabPages.Add(BuildCalibrationTab());
        tabs.TabPages.Add(BuildLiveTab());
        Controls.Add(tabs);
        Controls.Add(top);
    }

    private TabPage BuildRotationTab()
    {
        var page = new TabPage("1. Rotation import & editor");
        var importButtons = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 72, Padding = new Padding(3), WrapContents = true };
        importButtons.Controls.Add(new Label { Text = "Name:", AutoSize = true, Margin = new Padding(3, 7, 3, 0) });
        importButtons.Controls.Add(rotationName);
        importButtons.Controls.Add(MakeButton("Parse pasted guide", async (_, _) => await ImportRotationAsync()));
        importButtons.Controls.Add(MakeButton("Edit node", (_, _) => EditSelectedNode()));
        importButtons.Controls.Add(MakeButton("Move up", (_, _) => MoveSelectedNode(-1)));
        importButtons.Controls.Add(MakeButton("Move down", (_, _) => MoveSelectedNode(1)));
        importButtons.Controls.Add(MakeButton("Delete node", (_, _) => DeleteSelectedNode()));
        importButtons.Controls.Add(new Label { Text = "PvME link:", AutoSize = true, Margin = new Padding(12, 7, 3, 0) });
        importButtons.Controls.Add(pvmeLinkText);
        importButtons.Controls.Add(MakeButton("Fetch rotations", async (_, _) => await ImportPvmeLinkAsync()));

        var sourceGroup = new GroupBox { Text = "Discord/guide text", Dock = DockStyle.Fill };
        sourceGroup.Controls.Add(sourceText);
        var treeGroup = new GroupBox { Text = "Parsed phases and steps", Dock = DockStyle.Fill };
        treeGroup.Controls.Add(rotationTree);
        var sourceSplit = new SplitContainer { Dock = DockStyle.Fill, Orientation = Orientation.Vertical, SplitterDistance = 560 };
        sourceSplit.Panel1.Controls.Add(sourceGroup);
        sourceSplit.Panel2.Controls.Add(treeGroup);

        ConfigureTokenGrid();
        var tokenButtons = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 37, Padding = new Padding(3), WrapContents = false };
        tokenButtons.Controls.Add(MakeButton("Resolve selected via Wiki…", async (_, _) => await ResolveSelectedWikiAsync()));
        tokenButtons.Controls.Add(MakeButton("Resolve all automatically", async (_, _) => await ResolveAllWikiAsync()));
        tokenButtons.Controls.Add(MakeButton("Capture selected keybind", (_, _) => CaptureSelectedKeybind()));
        tokenButtons.Controls.Add(new Label { Text = "Yellow cells still need confirmation.", AutoSize = true, ForeColor = Color.DarkGoldenrod, Margin = new Padding(10, 8, 0, 0) });
        var tokenPanel = new Panel { Dock = DockStyle.Fill };
        tokenPanel.Controls.Add(tokenGrid);
        tokenPanel.Controls.Add(tokenButtons);

        var mainSplit = new SplitContainer { Dock = DockStyle.Fill, Orientation = Orientation.Horizontal, SplitterDistance = 365 };
        mainSplit.Panel1.Controls.Add(sourceSplit);
        mainSplit.Panel2.Controls.Add(tokenPanel);
        page.Controls.Add(mainSplit);
        page.Controls.Add(importButtons);
        return page;
    }

    private TabPage BuildCalibrationTab()
    {
        var page = new TabPage("2. Screen calibration");
        var tools = new FlowLayoutPanel { Dock = DockStyle.Right, Width = 275, FlowDirection = FlowDirection.TopDown, Padding = new Padding(8), WrapContents = false, AutoScroll = true };
        tools.Controls.Add(MakeWideButton("Capture RuneScape client", async (_, _) => await CaptureClientAsync()));
        tools.Controls.Add(MakeWideButton("Select action bar", (_, _) => SetSelectionMode(CalibrationSelectionMode.ActionBar)));
        tools.Controls.Add(MakeWideButton("Select adrenaline fill bar", (_, _) => SetSelectionMode(CalibrationSelectionMode.Adrenaline)));
        tools.Controls.Add(MakeWideButton("Clear calibration", (_, _) => ClearCalibration()));
        tools.Controls.Add(MakeWideButton("Run icon matching + OCR", async (_, _) => await AnalyzeCalibrationAsync()));
        tools.Controls.Add(new Label
        {
            AutoSize = true,
            MaximumSize = new Size(245, 0),
            ForeColor = Color.DimGray,
            Text = "Drag tightly around every complete action-bar grid. OCR reads the upper/lower keybind bands; uncertain results remain editable on tab 1."
        });
        tools.Controls.Add(calibrationStatus);
        page.Controls.Add(calibrationCanvas);
        page.Controls.Add(tools);
        return page;
    }

    private TabPage BuildLiveTab()
    {
        var page = new TabPage("3. Live tracker");
        var controls = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 76, Padding = new Padding(5), WrapContents = true };
        controls.Controls.Add(MakeButton("Start / pause", (_, _) => StartOrPause()));
        controls.Controls.Add(MakeButton("Reset", (_, _) => ResetTracker()));
        controls.Controls.Add(MakeButton("Show overlay", (_, _) => ShowOverlay()));
        controls.Controls.Add(clickThroughCheck);
        controls.Controls.Add(new Label { Text = "Start/pause:", AutoSize = true, Margin = new Padding(12, 7, 2, 0) });
        controls.Controls.Add(startHotkeyText);
        controls.Controls.Add(new Label { Text = "Reset:", AutoSize = true, Margin = new Padding(8, 7, 2, 0) });
        controls.Controls.Add(resetHotkeyText);
        controls.Controls.Add(MakeButton("Apply hotkeys", (_, _) => RegisterGlobalHotkeys()));
        controls.Controls.Add(new Label { Text = "Test token:", AutoSize = true, Margin = new Padding(12, 7, 2, 0) });
        controls.Controls.Add(simulationToken);
        controls.Controls.Add(MakeButton("Simulate", (_, _) => SimulateToken()));
        controls.Controls.Add(liveStatus);

        historyList.Columns.Add("Time", 90);
        historyList.Columns.Add("Token", 220);
        historyList.Columns.Add("Result", 110);
        historyList.Columns.Add("Source", 90);
        historyList.Columns.Add("Detail", 420);
        var group = new GroupBox { Text = "Live session history (not persisted)", Dock = DockStyle.Fill };
        group.Controls.Add(historyList);
        page.Controls.Add(group);
        page.Controls.Add(controls);
        return page;
    }

    private void ConfigureTokenGrid()
    {
        tokenGrid.AutoGenerateColumns = false;
        tokenGrid.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
        tokenGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Id", HeaderText = "Token", ReadOnly = true, Width = 145 });
        tokenGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Name", HeaderText = "Display name", Width = 155 });
        tokenGrid.Columns.Add(new DataGridViewComboBoxColumn { Name = "Kind", HeaderText = "Kind", Width = 100, DataSource = Enum.GetValues<TokenKind>() });
        tokenGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Wiki", HeaderText = "Icon source", ReadOnly = true, Width = 190 });
        tokenGrid.Columns.Add(new DataGridViewCheckBoxColumn { Name = "Confirmed", HeaderText = "Icon OK", Width = 60 });
        tokenGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Slot", HeaderText = "Slot", Width = 50 });
        tokenGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Key", HeaderText = "Keybind", Width = 100 });
        tokenGrid.Columns.Add(new DataGridViewComboBoxColumn { Name = "Confirmation", HeaderText = "Confirmation", Width = 145, DataSource = Enum.GetValues<ConfirmationMode>() });
    }

    private void WireEvents()
    {
        Load += async (_, _) => await InitializeAsync();
        FormClosing += OnFormClosing;
        tokenGrid.CellValueChanged += TokenGridCellValueChanged;
        tokenGrid.CurrentCellDirtyStateChanged += (_, _) => { if (tokenGrid.IsCurrentCellDirty) tokenGrid.CommitEdit(DataGridViewDataErrorContexts.Commit); };
        tokenGrid.DataError += (_, _) => { };
        rotationTree.NodeMouseDoubleClick += (_, _) => EditSelectedNode();
        calibrationCanvas.SelectionCompleted += CalibrationSelectionCompleted;
        clickThroughCheck.CheckedChanged += (_, _) => { settings.OverlayClickThrough = clickThroughCheck.Checked; overlay.SetClickThrough(clickThroughCheck.Checked); };
        detection.ActionDetected += (_, e) => SafeUi(() => HandleDetectedAction(e));
        detection.AdrenalineDetected += (_, e) => SafeUi(() => HandleAdrenaline(e));
        detection.DiagnosticMessage += (_, message) => SafeUi(() => applicationStatus.Text = message);
        overlay.FormClosing += (_, e) => { if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; overlay.Hide(); } };
    }

    private async Task InitializeAsync()
    {
        settings = await storage.LoadSettingsAsync();
        startHotkeyText.Text = settings.StartPauseHotkey;
        resetHotkeyText.Text = settings.ResetHotkey;
        clickThroughCheck.Checked = settings.OverlayClickThrough;
        overlay.Location = settings.OverlayLocation;
        overlay.Size = settings.OverlaySize;
        overlay.SetClickThrough(settings.OverlayClickThrough);
        RefreshProcesses();
        RegisterGlobalHotkeys();
        if (File.Exists(settings.LastRotationFile)) await LoadRotationAsync(settings.LastRotationFile);
    }

    private void RefreshProcesses()
    {
        var previousId = SelectedWindow?.Process?.Id;
        var windows = ProcessWindow.FindByProcessName("rs2client").ToList();
        windows.Add(new ProcessWindow(null));
        processCombo.DataSource = new BindingList<ProcessWindow>(windows);
        if (previousId.HasValue)
        {
            var previous = windows.FirstOrDefault(window => window.Process?.Id == previousId.Value);
            if (previous is not null) processCombo.SelectedItem = previous;
        }
        if (processCombo.SelectedIndex < 0 && windows.Count > 0) processCombo.SelectedIndex = 0;
    }

    private async Task ImportRotationAsync(IReadOnlyDictionary<string, PvmeEmojiReference>? emojiReferences = null)
    {
        document = parser.Parse(sourceText.Text, rotationName.Text);
        ApplyPvmeEmojiReferences(document, emojiReferences);
        currentRotationPath = null;
        engine = null;
        RefreshDocumentUi();
        applicationStatus.Text = $"Parsed {document.Sections.Count} sections and {document.Tokens.Count} unique tokens.";
        await ResolveWikiTokensAsync(document.Tokens.Values.Where(token => token.Kind != TokenKind.CueOnly));
    }

    private async Task ImportPvmeLinkAsync()
    {
        if (string.IsNullOrWhiteSpace(pvmeLinkText.Text)) return;
        SetBusy("Fetching PvME channel mapping and guide…");
        try
        {
            var import = await pvme.ImportAsync(pvmeLinkText.Text);
            using var dialog = new PvmeRotationDialog(import);
            if (dialog.ShowDialog(this) != DialogResult.OK || dialog.SelectedCandidate is not { } selected)
            {
                SetBusy("Ready");
                return;
            }
            sourceText.Text = selected.SourceText;
            rotationName.Text = $"{import.ChannelName} — {selected.Name}";
            await ImportRotationAsync(selected.Emojis);
            applicationStatus.Text = $"Imported '{selected.Name}' from PvME ({import.Rotations.Count} rotation(s) available in this channel).";
        }
        catch (Exception exception)
        {
            MessageBox.Show(this, exception.Message, "PvME import failed", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            SetBusy("PvME import failed.");
        }
    }

    private void RefreshDocumentUi()
    {
        rotationTree.BeginUpdate();
        rotationTree.Nodes.Clear();
        if (document is not null)
        {
            foreach (var section in document.Sections)
            {
                var sectionNode = new TreeNode(section.Name) { Tag = new TreeTag(section, null, null, null) };
                foreach (var entry in section.Entries)
                {
                    var entryNode = new TreeNode(DescribeEntry(entry)) { Tag = new TreeTag(section, entry, null, entry.Step) };
                    if (entry.Branch is not null)
                    {
                        foreach (var option in entry.Branch.Options)
                        {
                            var optionNode = new TreeNode(option.Condition.ToString()) { Tag = new TreeTag(section, entry, option, null) };
                            foreach (var step in option.Steps)
                                optionNode.Nodes.Add(new TreeNode(step.ToString()) { Tag = new TreeTag(section, entry, option, step) });
                            entryNode.Nodes.Add(optionNode);
                        }
                    }
                    sectionNode.Nodes.Add(entryNode);
                }
                rotationTree.Nodes.Add(sectionNode);
            }
            rotationTree.ExpandAll();
            rotationName.Text = document.Name;
        }
        rotationTree.EndUpdate();
        RefreshTokenGrid();
        RefreshSimulationTokens();
        RefreshCalibrationCanvas();
    }

    private static string DescribeEntry(RotationEntry entry) => entry.Kind switch
    {
        RotationEntryKind.Step => "→ " + entry.Step,
        RotationEntryKind.Note => "Note: " + entry.Note?.Text,
        RotationEntryKind.Branch => "Branch: " + entry.Branch?.Label,
        _ => entry.Kind.ToString()
    };

    private void EditSelectedNode()
    {
        if (document is null || rotationTree.SelectedNode?.Tag is not TreeTag tag) return;
        if (tag.Entry is null)
        {
            var value = TextPrompt.Show(this, "Edit section", "Section/phase name", tag.Section.Name);
            if (value is not null) tag.Section.Name = value.Trim();
        }
        else if (tag.Step is not null)
        {
            var value = TextPrompt.Show(this, "Edit step", "Use :tokens:, +, / and optional parentheses", tag.Step.ToString());
            if (value is not null)
            {
                var parsed = parser.Parse(value, "step");
                var step = parsed.Sections.SelectMany(s => s.Entries).Select(e => e.Step).FirstOrDefault(s => s is not null);
                if (step is not null)
                {
                    if (tag.BranchOption is not null)
                    {
                        var index = tag.BranchOption.Steps.IndexOf(tag.Step);
                        if (index >= 0) tag.BranchOption.Steps[index] = step;
                    }
                    else tag.Entry.Step = step;
                }
                MergeTokens(parsed);
            }
        }
        else if (tag.BranchOption is not null)
        {
            var value = TextPrompt.Show(this, "Edit branch", "Condition such as >50 or <=30", tag.BranchOption.Condition.Operator + tag.BranchOption.Condition.Percentage);
            var match = value is null ? null : System.Text.RegularExpressions.Regex.Match(value, @"^(>=|<=|>|<)\s*(\d+)");
            if (match?.Success == true)
            {
                tag.BranchOption.Condition.Operator = match.Groups[1].Value;
                tag.BranchOption.Condition.Percentage = int.Parse(match.Groups[2].Value);
            }
        }
        else if (tag.Entry.Note is not null)
        {
            var value = TextPrompt.Show(this, "Edit note", "Non-blocking instruction", tag.Entry.Note.Text);
            if (value is not null) tag.Entry.Note.Text = value;
        }
        RefreshDocumentUi();
    }

    private void MoveSelectedNode(int offset)
    {
        if (rotationTree.SelectedNode?.Tag is not TreeTag { Entry: not null } tag) return;
        if (tag.BranchOption is not null && tag.Step is not null)
        {
            var stepIndex = tag.BranchOption.Steps.IndexOf(tag.Step);
            var stepTarget = stepIndex + offset;
            if (stepIndex < 0 || stepTarget < 0 || stepTarget >= tag.BranchOption.Steps.Count) return;
            tag.BranchOption.Steps.RemoveAt(stepIndex);
            tag.BranchOption.Steps.Insert(stepTarget, tag.Step);
            RefreshDocumentUi();
            return;
        }
        var index = tag.Section.Entries.IndexOf(tag.Entry);
        var target = index + offset;
        if (index < 0 || target < 0 || target >= tag.Section.Entries.Count) return;
        tag.Section.Entries.RemoveAt(index);
        tag.Section.Entries.Insert(target, tag.Entry);
        RefreshDocumentUi();
    }

    private void DeleteSelectedNode()
    {
        if (document is null || rotationTree.SelectedNode?.Tag is not TreeTag tag) return;
        if (tag.BranchOption is not null && tag.Step is not null)
            tag.BranchOption.Steps.Remove(tag.Step);
        else if (tag.BranchOption is not null && tag.Entry?.Branch is not null)
            tag.Entry.Branch.Options.Remove(tag.BranchOption);
        else if (tag.Entry is null)
        {
            if (document.Sections.Count > 1) document.Sections.Remove(tag.Section);
        }
        else tag.Section.Entries.Remove(tag.Entry);
        RefreshDocumentUi();
    }

    private void MergeTokens(RotationDocument parsed)
    {
        if (document is null) return;
        foreach (var pair in parsed.Tokens) if (!document.Tokens.ContainsKey(pair.Key)) document.Tokens[pair.Key] = pair.Value;
    }

    private void RefreshTokenGrid()
    {
        updatingTokenGrid = true;
        tokenGrid.Rows.Clear();
        if (document is not null)
        {
            foreach (var token in document.Tokens.Values.OrderBy(token => token.Id))
            {
                var rowIndex = tokenGrid.Rows.Add(token.Id, token.DisplayName, token.Kind, DescribeWikiMatch(token), token.IconConfirmed,
                    token.Binding.SlotIndex < 0 ? string.Empty : token.Binding.SlotIndex.ToString(), token.Binding.KeyGesture, token.Binding.Confirmation);
                var row = tokenGrid.Rows[rowIndex];
                row.Tag = token;
                if (token.Kind == TokenKind.Trackable && (!token.IconConfirmed || token.Binding.OcrConfidence < 0.67))
                    row.DefaultCellStyle.BackColor = Color.FromArgb(255, 246, 210);
            }
        }
        updatingTokenGrid = false;
    }

    private void TokenGridCellValueChanged(object? sender, DataGridViewCellEventArgs e)
    {
        if (updatingTokenGrid || e.RowIndex < 0 || tokenGrid.Rows[e.RowIndex].Tag is not TokenDefinition token) return;
        var row = tokenGrid.Rows[e.RowIndex];
        token.DisplayName = Convert.ToString(row.Cells["Name"].Value) ?? token.DisplayName;
        if (row.Cells["Kind"].Value is TokenKind kind) token.Kind = kind;
        token.IconConfirmed = Convert.ToBoolean(row.Cells["Confirmed"].Value ?? false);
        token.Binding.SlotIndex = int.TryParse(Convert.ToString(row.Cells["Slot"].Value), out var slot) ? slot : -1;
        token.Binding.KeyGesture = Convert.ToString(row.Cells["Key"].Value) ?? string.Empty;
        if (row.Cells["Confirmation"].Value is ConfirmationMode mode) token.Binding.Confirmation = mode;
        if (token.Kind == TokenKind.CueOnly) token.Binding.Confirmation = ConfirmationMode.CueOnly;
        row.DefaultCellStyle.BackColor = token.Kind == TokenKind.Trackable && (!token.IconConfirmed || token.Binding.OcrConfidence < 0.67)
            ? Color.FromArgb(255, 246, 210) : Color.White;
        RefreshSimulationTokens();
    }

    private TokenDefinition? SelectedToken => tokenGrid.SelectedRows.Count > 0 ? tokenGrid.SelectedRows[0].Tag as TokenDefinition : null;

    private void CaptureSelectedKeybind()
    {
        if (SelectedToken is not { } token) return;
        using var dialog = new KeybindCaptureDialog(token.DisplayName);
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        token.Binding.KeyGesture = dialog.Gesture;
        token.Binding.OcrConfidence = 1;
        RefreshTokenGrid();
    }

    private async Task ResolveSelectedWikiAsync()
    {
        if (SelectedToken is not { } token) return;
        SetBusy($"Searching Wiki for {token.DisplayName}…");
        try
        {
            var candidates = await wiki.SearchAsync(token);
            if (candidates.Count == 0)
            {
                MessageBox.Show(this, "No suitable Wiki page with an icon was found. You can keep this token manual or cue-only.", "No icon", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            using var dialog = new WikiCandidateDialog(wiki, candidates);
            if (dialog.ShowDialog(this) == DialogResult.OK && dialog.SelectedCandidate is { } selected)
                await wiki.ApplyCandidateAsync(token, selected, true);
        }
        catch (Exception exception) { MessageBox.Show(this, exception.Message, "Wiki lookup failed", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        finally { RefreshTokenGrid(); SetBusy("Ready"); }
    }

    private async Task ResolveAllWikiAsync()
    {
        if (document is null) return;
        await ResolveWikiTokensAsync(document.Tokens.Values.Where(token => token.Kind != TokenKind.CueOnly));
    }

    private async Task ResolveWikiTokensAsync(IEnumerable<TokenDefinition> source)
    {
        var candidates = source.DistinctBy(token => token.Id, StringComparer.OrdinalIgnoreCase).ToList();
        if (candidates.Count == 0) return;
        var completed = 0;
        var resolved = 0;
        var wikiResolved = 0;
        var sourceResolved = 0;
        using var gate = new SemaphoreSlim(4);
        var tasks = candidates.Select(async token =>
        {
            await gate.WaitAsync();
            try
            {
                var match = await wiki.ResolveBestAsync(token);
                if (match is { PageKind: WikiPageKind.Ability or WikiPageKind.Item })
                {
                    await wiki.ApplyCandidateAsync(token, match, match.Confidence >= 0.9);
                    Interlocked.Increment(ref resolved);
                    Interlocked.Increment(ref wikiResolved);
                }
                else if (!string.IsNullOrWhiteSpace(token.SourceIconUrl))
                {
                    await wiki.ApplySourceIconAsync(token);
                    Interlocked.Increment(ref resolved);
                    Interlocked.Increment(ref sourceResolved);
                }
            }
            catch
            {
                if (!string.IsNullOrWhiteSpace(token.SourceIconUrl))
                {
                    try
                    {
                        await wiki.ApplySourceIconAsync(token);
                        Interlocked.Increment(ref resolved);
                        Interlocked.Increment(ref sourceResolved);
                    }
                    catch { }
                }
            }
            finally
            {
                gate.Release();
                var count = Interlocked.Increment(ref completed);
                SafeUi(() => SetBusy($"Wiki icons {count}/{candidates.Count}: {token.DisplayName}"));
            }
        });
        await Task.WhenAll(tasks);
        RefreshTokenGrid();
        SetBusy($"Icons resolved for {resolved}/{candidates.Count}: {wikiResolved} Wiki, {sourceResolved} exact PvME source icons.");
    }

    private static void ApplyPvmeEmojiReferences(
        RotationDocument rotation,
        IReadOnlyDictionary<string, PvmeEmojiReference>? emojiReferences)
    {
        if (emojiReferences is null) return;
        foreach (var (name, reference) in emojiReferences)
        {
            var id = RotationParser.NormalizeToken(name);
            if (!rotation.Tokens.TryGetValue(id, out var token)) continue;
            token.SourceIconUrl = reference.IconUrl;
            token.SourceIconLabel = reference.Label;
        }
    }

    private async Task CaptureClientAsync()
    {
        var window = SelectedWindow;
        if (window is null || window.HasExited)
        {
            MessageBox.Show(this, "Select a running RuneScape client first.");
            return;
        }
        Hide();
        try
        {
            await Task.Delay(250);
            capturedClient?.Dispose();
            capturedClient = window.Capture(true);
        }
        finally { Show(); Activate(); }
        if (capturedClient is null)
        {
            calibrationStatus.Text = "Capture failed. Try the entire-screen target or refresh processes.";
            return;
        }
        EnsureDocument();
        document!.Calibration.ClientWidth = capturedClient.Width;
        document.Calibration.ClientHeight = capturedClient.Height;
        document.Calibration.UseScreenCapture = true;
        calibrationCanvas.SetImage(capturedClient);
        RefreshCalibrationCanvas();
        calibrationStatus.Text = $"Captured {capturedClient.Width}×{capturedClient.Height}. Select each bar tightly.";
    }

    private void SetSelectionMode(CalibrationSelectionMode mode)
    {
        calibrationCanvas.SelectionMode = mode;
        calibrationStatus.Text = mode == CalibrationSelectionMode.ActionBar
            ? "Drag around one complete rectangular action-bar grid."
            : "Drag tightly around only the coloured adrenaline fill line.";
    }

    private void CalibrationSelectionCompleted(object? sender, CalibrationSelectionEventArgs e)
    {
        EnsureDocument();
        var profile = document!.Calibration;
        if (e.Mode == CalibrationSelectionMode.ActionBar)
        {
            profile.BarRegions.Add(SerializableRectangle.FromRectangle(e.Region));
            profile.Slots.AddRange(SlotGridDetector.Detect(e.Region, profile.Slots.Count));
            calibrationStatus.Text = $"Added bar; {profile.Slots.Count} slots detected in total.";
        }
        else if (e.Mode == CalibrationSelectionMode.Adrenaline)
        {
            profile.AdrenalineRegion = SerializableRectangle.FromRectangle(e.Region);
            calibrationStatus.Text = "Adrenaline region set.";
        }
        calibrationCanvas.SelectionMode = CalibrationSelectionMode.None;
        RefreshCalibrationCanvas();
    }

    private void ClearCalibration()
    {
        if (document is null) return;
        document.Calibration.BarRegions.Clear();
        document.Calibration.Slots.Clear();
        document.Calibration.AdrenalineRegion = new SerializableRectangle();
        foreach (var token in document.Tokens.Values)
        {
            token.Binding.SlotIndex = -1;
            token.Binding.KeyGesture = string.Empty;
            token.Binding.OcrConfidence = 0;
        }
        RefreshCalibrationCanvas();
        RefreshTokenGrid();
        calibrationStatus.Text = "Calibration cleared.";
    }

    private async Task AnalyzeCalibrationAsync()
    {
        if (document is null || capturedClient is null || document.Calibration.Slots.Count == 0)
        {
            MessageBox.Show(this, "Capture the client and select at least one action bar first.");
            return;
        }
        var directory = Path.Combine(storage.ProfileDirectory, SafeFileName(document.Name));
        Directory.CreateDirectory(directory);
        for (var index = 0; index < document.Calibration.Slots.Count; index++)
        {
            var slot = document.Calibration.Slots[index];
            calibrationStatus.Text = $"OCR slot {index + 1}/{document.Calibration.Slots.Count}…";
            using var crop = FrameAnalyzer.Crop(capturedClient, slot.Region.ToRectangle());
            var path = Path.Combine(directory, $"slot_{slot.Index}.png");
            crop.Save(path, ImageFormat.Png);
            slot.ReadyTemplateFile = path;
            try
            {
                var result = await ocr.ReadAsync(crop);
                slot.OcrText = result.Gesture;
                slot.OcrConfidence = result.Confidence;
            }
            catch { slot.OcrText = string.Empty; slot.OcrConfidence = 0; }
        }

        var available = new HashSet<int>(document.Calibration.Slots.Select(slot => slot.Index));
        foreach (var token in document.Tokens.Values.Where(token => token.Kind == TokenKind.Trackable && File.Exists(token.CachedIconFile)))
        {
            using var loaded = Image.FromFile(token.CachedIconFile);
            using var icon = new Bitmap(loaded);
            var best = (Index: -1, Score: 0.0);
            foreach (var slot in document.Calibration.Slots.Where(slot => available.Contains(slot.Index)))
            {
                using var crop = FrameAnalyzer.Crop(capturedClient, slot.Region.ToRectangle());
                var score = FrameAnalyzer.IconSimilarity(icon, crop);
                if (score > best.Score) best = (slot.Index, score);
            }
            if (best.Index >= 0 && best.Score >= 0.56)
            {
                token.Binding.SlotIndex = best.Index;
                var slot = document.Calibration.Slots.First(value => value.Index == best.Index);
                token.Binding.KeyGesture = slot.OcrText;
                token.Binding.OcrConfidence = slot.OcrConfidence;
                available.Remove(best.Index);
            }
        }
        RefreshTokenGrid();
        RefreshCalibrationCanvas();
        calibrationStatus.Text = "Matching complete. Confirm yellow Wiki/keybind rows on tab 1.";
    }

    private void RefreshCalibrationCanvas()
    {
        if (document is null) return;
        calibrationCanvas.BarRegions = document.Calibration.BarRegions;
        calibrationCanvas.Slots = document.Calibration.Slots;
        calibrationCanvas.AdrenalineRegion = document.Calibration.AdrenalineRegion;
        calibrationCanvas.Invalidate();
    }

    private void StartOrPause()
    {
        if (document is null) { MessageBox.Show(this, "Import or load a rotation first."); return; }
        if (engine is null)
        {
            var errors = ValidateForTracking(document);
            if (errors.Count > 0)
            {
                MessageBox.Show(this, string.Join(Environment.NewLine, errors.Take(12)), "Setup incomplete", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            var window = SelectedWindow;
            if (window is null || window.HasExited) { MessageBox.Show(this, "Select a running RuneScape client."); return; }
            var currentSize = window.Size;
            if (document.Calibration.ClientWidth > 0 &&
                (Math.Abs(currentSize.Width - document.Calibration.ClientWidth) > 2 || Math.Abs(currentSize.Height - document.Calibration.ClientHeight) > 2))
            {
                MessageBox.Show(this,
                    $"The calibrated client was {document.Calibration.ClientWidth}×{document.Calibration.ClientHeight}, but the selected client is {currentSize.Width}×{currentSize.Height}. Capture and calibrate again to prevent shifted slots.",
                    "Client layout changed", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            engine = new RotationEngine(document);
            engine.ProgressChanged += (_, _) => SafeUi(UpdateLiveUi);
            detection.Start(window, document);
            engine.Start();
            ShowOverlay();
        }
        else engine.TogglePause();
        UpdateLiveUi();
    }

    private void ResetTracker()
    {
        engine?.Reset();
        historyList.Items.Clear();
        UpdateLiveUi();
    }

    private void ShowOverlay()
    {
        if (document is null) return;
        if (!overlay.Visible) overlay.Show(this);
        overlay.SetClickThrough(clickThroughCheck.Checked);
        UpdateLiveUi();
    }

    private void SimulateToken()
    {
        if (simulationToken.SelectedItem is not TokenDefinition token) return;
        engine ??= document is null ? null : new RotationEngine(document);
        engine?.Start();
        engine?.RegisterAction(token.Id, DateTime.Now, source: "simulation");
        UpdateLiveUi();
    }

    private void HandleDetectedAction(ActionDetectedEventArgs e)
    {
        engine?.RegisterAction(e.Token, e.Timestamp.ToLocalTime(), source: e.Source);
        UpdateLiveUi();
    }

    private void HandleAdrenaline(AdrenalineDetectedEventArgs e)
    {
        if (e.Confidence >= 0.15) engine?.UpdateAdrenaline(e.Percentage);
    }

    private void UpdateLiveUi()
    {
        if (engine is null || document is null)
        {
            liveStatus.Text = "Ready";
            return;
        }
        var snapshot = engine.GetSnapshot();
        liveStatus.Text = $"{snapshot.SectionName} • {snapshot.Status} • {snapshot.Adrenaline:0}%";
        overlay.UpdateState(document, snapshot);
        historyList.BeginUpdate();
        historyList.Items.Clear();
        foreach (var item in engine.History.TakeLast(300).Reverse())
        {
            var row = new ListViewItem(item.Timestamp.ToString("HH:mm:ss.fff"));
            row.SubItems.Add(item.Token);
            row.SubItems.Add(item.Kind.ToString());
            row.SubItems.Add(item.Source);
            row.SubItems.Add(item.Detail);
            row.ForeColor = item.Kind is TrackerHistoryKind.Unexpected or TrackerHistoryKind.Skipped ? Color.Firebrick : Color.Black;
            historyList.Items.Add(row);
        }
        historyList.EndUpdate();
    }

    private static List<string> ValidateForTracking(RotationDocument rotation)
    {
        var errors = new List<string>();
        var used = rotation.Sections.SelectMany(section => section.Entries)
            .SelectMany(entry => entry.Step is not null ? entry.Step.AllTokens : entry.Branch?.Options.SelectMany(option => option.Steps).SelectMany(step => step.AllTokens) ?? [])
            .Distinct(StringComparer.OrdinalIgnoreCase);
        foreach (var tokenId in used)
        {
            if (!rotation.Tokens.TryGetValue(tokenId, out var token)) { errors.Add($":{tokenId}: has no token definition."); continue; }
            if (token.Kind == TokenKind.CueOnly) continue;
            if (token.Binding.Confirmation != ConfirmationMode.InputOnly && token.Binding.SlotIndex < 0)
                errors.Add($":{tokenId}: is not mapped to an action-bar slot.");
            if (token.Binding.Confirmation == ConfirmationMode.InputOnly && string.IsNullOrWhiteSpace(token.Binding.KeyGesture))
                errors.Add($":{tokenId}: input-only requires a keybind.");
            if (token.Kind == TokenKind.Trackable && !token.IconConfirmed)
                errors.Add($":{tokenId}: the Wiki/manual icon match is not confirmed.");
        }
        if (rotation.Calibration.Slots.Count == 0) errors.Add("No action-bar slots calibrated.");
        return errors;
    }

    private async Task LoadRotationFromDialogAsync()
    {
        using var dialog = new OpenFileDialog { Filter = "Ability rotations (*.json)|*.json|All files (*.*)|*.*", InitialDirectory = storage.RotationDirectory };
        if (dialog.ShowDialog(this) == DialogResult.OK) await LoadRotationAsync(dialog.FileName);
    }

    private async Task LoadRotationAsync(string path)
    {
        try
        {
            document = await storage.LoadRotationAsync(path);
            if (document is null) return;
            currentRotationPath = path;
            sourceText.Text = document.SourceText;
            rotationName.Text = document.Name;
            settings.LastRotationFile = path;
            RefreshDocumentUi();
            applicationStatus.Text = "Loaded " + path;
        }
        catch (Exception exception) { MessageBox.Show(this, exception.Message, "Load failed"); }
    }

    private async Task SaveRotationAsync()
    {
        if (document is null) return;
        ApplyTokenGridEdits();
        document.Name = rotationName.Text.Trim();
        try
        {
            currentRotationPath = await storage.SaveRotationAsync(document, currentRotationPath);
            settings.LastRotationFile = currentRotationPath;
            await storage.SaveSettingsAsync(settings);
            applicationStatus.Text = "Saved " + currentRotationPath;
        }
        catch (Exception exception) { MessageBox.Show(this, exception.Message, "Save failed"); }
    }

    private void ApplyTokenGridEdits()
    {
        if (tokenGrid.CurrentCell is not null) tokenGrid.EndEdit();
        foreach (DataGridViewRow row in tokenGrid.Rows)
        {
            if (row.Tag is not TokenDefinition token) continue;
            token.DisplayName = Convert.ToString(row.Cells["Name"].Value) ?? token.DisplayName;
            token.Binding.KeyGesture = Convert.ToString(row.Cells["Key"].Value) ?? string.Empty;
        }
    }

    private void RefreshSimulationTokens()
    {
        var selected = simulationToken.SelectedItem as TokenDefinition;
        simulationToken.DataSource = document is null ? null : new BindingList<TokenDefinition>(document.Tokens.Values.Where(token => token.Kind != TokenKind.CueOnly).ToList());
        simulationToken.DisplayMember = nameof(TokenDefinition.DisplayName);
        if (selected is not null) simulationToken.SelectedItem = selected;
    }

    private static string DescribeWikiMatch(TokenDefinition token)
    {
        if (!string.IsNullOrWhiteSpace(token.WikiTitle))
        {
            var modifiers = token.WikiModifiers.Count == 0 ? string.Empty : " + " + string.Join(" + ", token.WikiModifiers);
            return $"{token.WikiTitle}{modifiers} [{token.WikiPageKind}]";
        }
        return token.SourceIconLabel;
    }

    private void EnsureDocument()
    {
        document ??= new RotationDocument { Name = rotationName.Text.Trim() };
    }

    private void RegisterGlobalHotkeys()
    {
        if (!IsHandleCreated) return;
        UnregisterHotKey(Handle, 1);
        UnregisterHotKey(Handle, 2);
        var startOk = TryRegisterHotkey(1, startHotkeyText.Text);
        var resetOk = TryRegisterHotkey(2, resetHotkeyText.Text);
        settings.StartPauseHotkey = startHotkeyText.Text;
        settings.ResetHotkey = resetHotkeyText.Text;
        applicationStatus.Text = startOk && resetOk ? "Global hotkeys active." : "One or more hotkeys are already in use.";
    }

    private bool TryRegisterHotkey(int id, string text)
    {
        var parts = text.Split('+', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        uint modifiers = 0;
        Keys key = Keys.None;
        foreach (var part in parts)
        {
            if (part.Equals("Ctrl", StringComparison.OrdinalIgnoreCase)) modifiers |= 0x0002;
            else if (part.Equals("Alt", StringComparison.OrdinalIgnoreCase)) modifiers |= 0x0001;
            else if (part.Equals("Shift", StringComparison.OrdinalIgnoreCase)) modifiers |= 0x0004;
            else if (Enum.TryParse(part, true, out Keys parsed)) key = parsed;
        }
        return key != Keys.None && RegisterHotKey(Handle, id, modifiers | 0x4000, (uint)key);
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == WmHotkey)
        {
            if (message.WParam == (IntPtr)1) StartOrPause();
            else if (message.WParam == (IntPtr)2) ResetTracker();
        }
        base.WndProc(ref message);
    }

    private void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (shuttingDown) return;
        shuttingDown = true;
        detection.Stop();
        if (overlay.Visible)
        {
            settings.OverlayLocation = overlay.Location;
            settings.OverlaySize = overlay.Size;
        }
        overlay.Hide();
        settings.OverlayClickThrough = clickThroughCheck.Checked;
        UnregisterHotKey(Handle, 1);
        UnregisterHotKey(Handle, 2);
        try
        {
            if (document is not null && currentRotationPath is not null)
            {
                ApplyTokenGridEdits();
                storage.SaveRotation(document, currentRotationPath);
            }
            storage.SaveSettings(settings);
        }
        catch (Exception exception)
        {
            System.Diagnostics.Debug.WriteLine("Could not save AbilityTracker state while closing: " + exception);
        }
        finally
        {
            detection.Dispose();
            wiki.Dispose();
            pvme.Dispose();
            overlay.Dispose();
            capturedClient?.Dispose();
        }
    }

    private static string SafeFileName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var result = new string(value.Select(c => invalid.Contains(c) ? '_' : c).ToArray());
        return string.IsNullOrWhiteSpace(result) ? "Default" : result;
    }

    private void SetBusy(string text) { applicationStatus.Text = text; applicationStatus.Refresh(); }
    private void SafeUi(Action action) { if (IsDisposed) return; if (InvokeRequired) BeginInvoke(action); else action(); }
    private static Button MakeButton(string text, EventHandler handler) { var button = new Button { Text = text, AutoSize = true }; button.Click += handler; return button; }
    private static Button MakeWideButton(string text, EventHandler handler) { var button = MakeButton(text, handler); button.Width = 245; return button; }

    private sealed record TreeTag(RotationSection Section, RotationEntry? Entry, BranchOption? BranchOption, RotationStep? Step);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint modifiers, uint virtualKey);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);
}
