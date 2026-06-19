using Dungeons.Common;
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Data;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Dungeons
{
    public partial class MainForm : Form
    {
        static readonly Point NotFound = new(-1, -1);
        static readonly Point DefaultOffset = new(710, 330);

        private readonly MapForm mapForm;
        private readonly TeamSyncManager teamSync = new();
        private TextBox teamNameTextBox;
        private TextBox teamRelayRoomTextBox;
        private Button teamRelayCreateButton;
        private Button teamRelayJoinButton;
        private Button teamDisconnectButton;
        private Label teamStatusLabel;
        private CheckBox overlayTopMostCheckBox;
        private CheckBox overlayTransparentMapCheckBox;
        private CheckBox overlayAutoAlignCheckBox;
        private CheckBox captureScreenCheckBox;
        private Button overlayClearAnnotationsButton;
        private Button overlayDebugButton;

        public MainForm()
        {
            InitializeComponent();

            mapForm = new MapForm(this);
            InitializeTeamControls();
            InitializeOverlayControls();
            mapForm.AnnotationChanged += MapForm_AnnotationChanged;
            mapForm.AnnotationsCleared += MapForm_AnnotationsCleared;
            mapForm.GatestoneChanged += MapForm_GatestoneChanged;
            teamSync.AnnotationReceived += TeamSync_AnnotationReceived;
            teamSync.GatestoneReceived += TeamSync_GatestoneReceived;
            teamSync.ClearAnnotationsReceived += TeamSync_ClearAnnotationsReceived;
            teamSync.StatusChanged += TeamSync_StatusChanged;
            //typeof(DataGridView).InvokeMember("DoubleBuffered", BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.SetProperty, null, dataGridView1, new object[] { true });

            foreach (DataGridViewColumn column in dataGridView1.Columns)
            {
                column.SortMode = DataGridViewColumnSortMode.NotSortable;
            }

            UpdateSaveLocationTextBoxes();
            if (Properties.Settings.Default.UpgradeRequired)
            {
                Properties.Settings.Default.Upgrade();
                Properties.Settings.Default.UpgradeRequired = false;
                Properties.Settings.Default.Save();
                Log("Imported settings from previous version");
            }
        }

        public ProcessWindow SelectedWindow => windowComboBox.SelectedItem as ProcessWindow;

        public DataGridViewRow AddRow(Dictionary<string, string> data)
        {
            if (data == null)
                return null;

            var gridRow = dataGridView1.Rows[dataGridView1.Rows.Add()];
            foreach (var pair in data)
            {
                if (dataGridView1.Columns.Contains(pair.Key))
                    gridRow.Cells[pair.Key] = new DataGridViewTextBoxCell { Value = pair.Value };
            }
            return gridRow;
        }

        public void Log(string text)
        {
            logTextBox.AppendText(text + Environment.NewLine);
        }

        public void RefreshProcessesList()
        {
            var selectedItem = windowComboBox.SelectedItem;
            var list = (from x in Process.GetProcessesByName("rs2client") select new ProcessWindow(x)).ToList();
            list.Add(new ProcessWindow(null));
            windowComboBox.DataSource = list;
            windowComboBox.SelectedItem = selectedItem == null ? list.FirstOrDefault() : selectedItem;
        }

        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);

            NativeMethods.RegisterHotKey(Handle, 0, 0, NativeMethods.VK_F11);
            dataGridView1.Font = new Font("Calibri", 11);

            windowComboBox.DataSource = (from x in Process.GetProcessesByName("rs2client") select new ProcessWindow(x)).ToList();
            Log("Started up, calibrating");
            _ = mapForm.CalibrateAsync();
            if (Screen.FromPoint(Properties.Settings.Default.MainFormLocation) != null)
            {
                Location = Properties.Settings.Default.MainFormLocation;
                if (!this.IsOnScreen())
                {
                    Location = new Point(Screen.PrimaryScreen.WorkingArea.Width - Width, 0);
                }
            }
            mapForm.Show(this);
        }

        protected override void OnClosing(CancelEventArgs e)
        {
            base.OnClosing(e);

            teamSync.Dispose();
            Properties.Settings.Default.MainFormLocation = Location;
            Properties.Settings.Default.MapFormLocation = mapForm.Location;
            Properties.Settings.Default.Save();
        }

        private void InitializeTeamControls()
        {
            const int y = 70;
            panel1.MinimumSize = new Size(0, 130);

            var teamNameLabel = new Label
            {
                AutoSize = true,
                Location = new Point(11, y + 4),
                Text = "RSN:"
            };
            teamNameTextBox = new TextBox
            {
                Location = new Point(45, y + 1),
                Size = new Size(120, 23),
                Text = Environment.UserName
            };
            var relayRoomLabel = new Label
            {
                AutoSize = true,
                Location = new Point(174, y + 4),
                Text = "Room:"
            };
            teamRelayRoomTextBox = new TextBox
            {
                Location = new Point(216, y + 1),
                Size = new Size(72, 23),
                Text = TeamSyncManager.CreateRoomCode()
            };
            teamRelayCreateButton = new Button
            {
                FlatStyle = FlatStyle.System,
                Location = new Point(294, y),
                Size = new Size(83, 23),
                Text = "New room"
            };
            teamRelayJoinButton = new Button
            {
                FlatStyle = FlatStyle.System,
                Location = new Point(383, y),
                Size = new Size(54, 23),
                Text = "Join"
            };
            teamDisconnectButton = new Button
            {
                FlatStyle = FlatStyle.System,
                Location = new Point(443, y),
                Size = new Size(76, 23),
                Text = "Disconnect"
            };
            teamStatusLabel = new Label
            {
                AutoEllipsis = true,
                Location = new Point(528, y + 4),
                Size = new Size(226, 15),
                Text = "Team sync offline"
            };

            teamRelayCreateButton.Click += TeamRelayCreateButton_Click;
            teamRelayJoinButton.Click += TeamRelayJoinButton_Click;
            teamDisconnectButton.Click += TeamDisconnectButton_Click;
            panel1.Controls.AddRange(new Control[]
            {
                teamNameLabel,
                teamNameTextBox,
                relayRoomLabel,
                teamRelayRoomTextBox,
                teamRelayCreateButton,
                teamRelayJoinButton,
                teamDisconnectButton,
                teamStatusLabel
            });
            UpdateTeamButtons();
        }

        private void InitializeOverlayControls()
        {
            const int y = 99;
            panel1.MinimumSize = new Size(0, 160);

            var overlayLabel = new Label
            {
                AutoSize = true,
                Location = new Point(11, y + 4),
                Text = "Overlay:"
            };
            overlayTopMostCheckBox = new CheckBox
            {
                AutoSize = true,
                Checked = true,
                FlatStyle = FlatStyle.System,
                Location = new Point(70, y + 2),
                Text = "Top-most"
            };
            overlayTransparentMapCheckBox = new CheckBox
            {
                AutoSize = true,
                Checked = true,
                FlatStyle = FlatStyle.System,
                Location = new Point(157, y + 2),
                Text = "Transparent map"
            };
            overlayAutoAlignCheckBox = new CheckBox
            {
                AutoSize = true,
                Checked = true,
                FlatStyle = FlatStyle.System,
                Location = new Point(290, y + 2),
                Text = "Auto align"
            };
            captureScreenCheckBox = new CheckBox
            {
                AutoSize = true,
                FlatStyle = FlatStyle.System,
                Location = new Point(390, y + 2),
                Text = "Screen capture"
            };
            overlayClearAnnotationsButton = new Button
            {
                FlatStyle = FlatStyle.System,
                Location = new Point(513, y),
                Size = new Size(114, 23),
                Text = "Clear annotations"
            };
            overlayDebugButton = new Button
            {
                FlatStyle = FlatStyle.System,
                Location = new Point(633, y),
                Size = new Size(58, 23),
                Text = "Debug"
            };

            overlayTopMostCheckBox.CheckedChanged += OverlayTopMostCheckBox_CheckedChanged;
            overlayTransparentMapCheckBox.CheckedChanged += OverlayTransparentMapCheckBox_CheckedChanged;
            overlayAutoAlignCheckBox.CheckedChanged += OverlayAutoAlignCheckBox_CheckedChanged;
            captureScreenCheckBox.CheckedChanged += CaptureScreenCheckBox_CheckedChanged;
            overlayClearAnnotationsButton.Click += OverlayClearAnnotationsButton_Click;
            overlayDebugButton.Click += OverlayDebugButton_Click;

            panel1.Controls.AddRange(new Control[]
            {
                overlayLabel,
                overlayTopMostCheckBox,
                overlayTransparentMapCheckBox,
                overlayAutoAlignCheckBox,
                captureScreenCheckBox,
                overlayClearAnnotationsButton,
                overlayDebugButton
            });

            ApplyOverlayControls();
        }

        private async void TeamRelayCreateButton_Click(object sender, EventArgs e)
        {
            await RunTeamActionAsync(async () =>
            {
                teamRelayRoomTextBox.Text = TeamSyncManager.CreateRoomCode();
                await teamSync.ConnectRelayAsync(TeamSyncManager.DefaultRelayUrl, teamRelayRoomTextBox.Text, teamNameTextBox.Text);
                teamRelayRoomTextBox.Text = teamSync.RelayRoomCode;
            });
        }

        private async void TeamRelayJoinButton_Click(object sender, EventArgs e)
        {
            await RunTeamActionAsync(async () =>
            {
                if (string.IsNullOrWhiteSpace(teamRelayRoomTextBox.Text))
                    throw new InvalidOperationException("Fill in a relay room code first.");

                await teamSync.ConnectRelayAsync(TeamSyncManager.DefaultRelayUrl, teamRelayRoomTextBox.Text, teamNameTextBox.Text);
                teamRelayRoomTextBox.Text = teamSync.RelayRoomCode;
            });
        }

        private void TeamDisconnectButton_Click(object sender, EventArgs e)
        {
            teamSync.Disconnect();
            mapForm.ClearTeamGatestones();
            UpdateTeamButtons();
        }

        private async Task RunTeamActionAsync(Func<Task> action)
        {
            try
            {
                await action();
            }
            catch (Exception ex)
            {
                Log($"Team sync error: {ex.Message}");
            }
            finally
            {
                UpdateTeamButtons();
            }
        }

        private void MapForm_AnnotationChanged(object sender, AnnotationChangedEventArgs e)
        {
            teamSync.SendAnnotation(e.Location, e.Text);
        }

        private void MapForm_AnnotationsCleared(object sender, EventArgs e)
        {
            teamSync.SendClearAnnotations();
        }

        private void MapForm_GatestoneChanged(object sender, GatestoneChangedEventArgs e)
        {
            var locationText = e.Location.X < 0 ? "cleared" : e.Location.ToChessString();
            Log($"Detected local G{e.GatestoneIndex} = {locationText}");
            teamSync.SendGatestone(e.GatestoneIndex, e.Location);
        }

        private void TeamSync_AnnotationReceived(object sender, TeamSyncAnnotationEventArgs e)
        {
            RunOnUi(() =>
            {
                mapForm.ApplyTeamAnnotation(e.Location, e.Text);
                Log($"{e.SenderName}: {e.Location.ToChessString()} = {e.Text}");
            });
        }

        private void TeamSync_ClearAnnotationsReceived(object sender, string senderName)
        {
            RunOnUi(() =>
            {
                mapForm.ApplyTeamClearAnnotations();
                Log($"{senderName} cleared team annotations");
            });
        }

        private void TeamSync_GatestoneReceived(object sender, TeamSyncGatestoneEventArgs e)
        {
            RunOnUi(() =>
            {
                mapForm.ApplyTeamGatestone(e.SenderId, e.SenderName, e.GatestoneIndex, e.Location);
                var locationText = e.Location.X < 0 ? "cleared" : e.Location.ToChessString();
                Log($"{e.SenderName}: G{e.GatestoneIndex} = {locationText}");
            });
        }

        private void TeamSync_StatusChanged(object sender, string status)
        {
            RunOnUi(() =>
            {
                teamStatusLabel.Text = GetTeamStatusText();
                Log(status);
                if (teamSync.IsConnected && (status.StartsWith("Connected to ") || status.Contains(" joined team sync") || status.StartsWith("Team mate connected")))
                    SendLocalGatestones();
                if (!teamSync.IsConnected)
                    mapForm.ClearTeamGatestones();
                UpdateTeamButtons();
            });
        }

        private void SendLocalGatestones()
        {
            foreach (var pair in mapForm.GetLocalGatestones())
                teamSync.SendGatestone(pair.Key, pair.Value);
        }

        private void RunOnUi(Action action)
        {
            if (IsDisposed)
                return;

            if (InvokeRequired)
                BeginInvoke(action);
            else
                action();
        }

        private void UpdateTeamButtons()
        {
            if (teamRelayCreateButton == null)
                return;

            teamRelayCreateButton.Enabled = !teamSync.IsConnected;
            teamRelayJoinButton.Enabled = !teamSync.IsConnected;
            teamDisconnectButton.Enabled = teamSync.IsConnected;
            teamStatusLabel.Text = GetTeamStatusText();
        }

        private string GetTeamStatusText()
        {
            return teamSync.IsRelayConnected ? $"Relay {teamSync.RelayRoomCode}" : teamSync.IsHosting ? "Hosting" : teamSync.IsConnected ? "Connected" : "Team sync offline";
        }

        private void ApplyOverlayControls()
        {
            if (mapForm == null)
                return;

            mapForm.SetMapTopMost(overlayTopMostCheckBox?.Checked ?? false);
            mapForm.SetTransparentMap(overlayTransparentMapCheckBox?.Checked ?? true);
            mapForm.SetAutoAlignMap(overlayAutoAlignCheckBox?.Checked ?? true);
            mapForm.SetUseScreenCapture(captureScreenCheckBox?.Checked ?? false);
        }

        private void OverlayTopMostCheckBox_CheckedChanged(object sender, EventArgs e)
        {
            mapForm.SetMapTopMost(overlayTopMostCheckBox.Checked);
        }

        private void OverlayTransparentMapCheckBox_CheckedChanged(object sender, EventArgs e)
        {
            mapForm.SetTransparentMap(overlayTransparentMapCheckBox.Checked);
        }

        private void OverlayAutoAlignCheckBox_CheckedChanged(object sender, EventArgs e)
        {
            mapForm.SetAutoAlignMap(overlayAutoAlignCheckBox.Checked);
        }

        private void CaptureScreenCheckBox_CheckedChanged(object sender, EventArgs e)
        {
            mapForm.SetUseScreenCapture(captureScreenCheckBox.Checked);
        }

        private void OverlayClearAnnotationsButton_Click(object sender, EventArgs e)
        {
            mapForm.ClearAnnotations();
        }

        private void OverlayDebugButton_Click(object sender, EventArgs e)
        {
            mapForm.SaveGatestoneDebug();
        }

        protected override void WndProc(ref Message m)
        {
            switch (m.Msg)
            {
                case NativeMethods.WM_HOTKEY:
                    captureButton.PerformClick();
                    break;
                default:
                    base.WndProc(ref m);
                    break;
            }
        }

        /// <summary>
        /// Captures the winterface.
        /// </summary>
        /// <returns>true if winterface was found; otherwise, false.</returns>
        private async Task<bool> CaptureWinterfaceAsync()
        {
            using var bmp = mapForm.RSWindow?.Capture(captureScreenCheckBox.Checked);
            if (bmp == null)
                return false;
            var dict = await Task.Run(() => ParseWinterfaceBitmap(bmp, saveImagesCheckBox.Checked));
            if (dict == null)
                return false;

            if (saveImagesCheckBox.Checked)
                mapForm.SaveMap();
            var row = AddRow(dict);
            if (row != null)
            {
                var visibleCellValues = from DataGridViewCell cell in row.Cells
                                        where cell.Visible
                                        select cell.Value;
                Clipboard.SetText(string.Join("\t", visibleCellValues));
            }
            return true;
        }

        private Dictionary<string, string> ParseWinterfaceBitmap(Bitmap bmp, bool saveToFile = false)
        {
            using var b = new UnsafeBitmap(bmp, ImageLockMode.ReadOnly);
            Point p;
            if (b.IsMatch(Properties.Resources.WinterfaceMarker, DefaultOffset.X, DefaultOffset.Y, 0))
                p = DefaultOffset;
            else
                p = b.FindMatch(Properties.Resources.WinterfaceMarker, 0);

            if (p == NotFound)
                return null;

            var w = new Winterface(b, p.X, p.Y);

            var fields = new List<Field>
            {
                Field.Time,
                Field.Floor,
                Field.FloorXP,
                Field.PrestigeXP,
                Field.BaseXP,
                Field.SizeMod,
                Field.DifficultyMod,
                Field.LevelMod,
                Field.FloorXPBoost,
                Field.TotalMod,
                Field.FinalXP
            };

            var data = (from f in fields
                        select new { Key = f.Name, Value = w.ReadField(f) }).ToDictionary(a => a.Key, a => a.Value);

            var floorSizeMod = data["SizeMod"];
            var sizeText = floorSizeMod == "+850" ? "Large" : floorSizeMod == "+350" ? "Medium" : "Small";
            data["FloorSize"] = sizeText;
            data["BonusMod"] = w.GetBonus().ToString("P1");
            if (mapForm != null)
            {
                data["Roomcount"] = mapForm.Roomcount.ToString();
                data["DeadEnds"] = mapForm.LeafCount.ToString();
            }
            var now = DateTime.Now;
            data["Timestamp"] = now.ToString();

            Directory.CreateDirectory(Properties.Settings.Default.WinterfaceSaveLocation);
            if (saveToFile && Directory.Exists(Properties.Settings.Default.WinterfaceSaveLocation))
            {
                // The \\g is because g is a date format character
                w.Save(Path.Combine(Properties.Settings.Default.WinterfaceSaveLocation, now.ToString("yyyy-MM-dd HH-mm-ss.pn\\g")));
            }

            return data;
        }

        private void UpdateSaveLocationTextBoxes()
        {
            mapSaveLocationTextBox.Text = Properties.Settings.Default.MapSaveLocation;
            winterfaceSaveLocationTextBox.Text = Properties.Settings.Default.WinterfaceSaveLocation;
        }

        private void browseMapSaveLocationButton_Click(object sender, EventArgs e)
        {
            if (mapFolderBrowserDialog.ShowDialog() == DialogResult.OK)
            {
                Properties.Settings.Default.MapSaveLocation = mapFolderBrowserDialog.SelectedPath;
                Properties.Settings.Default.Save();
                UpdateSaveLocationTextBoxes();
            }
        }

        private void browseWinterfaceSaveLocationButton_Click(object sender, EventArgs e)
        {
            if (winterfaceFolderBrowserDialog.ShowDialog() == DialogResult.OK)
            {
                Properties.Settings.Default.WinterfaceSaveLocation = winterfaceFolderBrowserDialog.SelectedPath;
                Properties.Settings.Default.Save();
                UpdateSaveLocationTextBoxes();
            }
        }

        private void ComboBox1_DropDown(object sender, EventArgs e)
        {
            RefreshProcessesList();
        }

        private async void ComboBox1_SelectionChangeCommitted(object sender, EventArgs e)
        {
            Log("Selected index changed, calibrating");
            await mapForm.CalibrateAsync();
        }

        private void SaveMapButton_Click(object sender, EventArgs e)
        {
            mapForm.SaveMap();
        }

        private async void CaptureButton_Click(object sender, EventArgs e)
        {
            if (!await CaptureWinterfaceAsync())
                await mapForm.CalibrateAsync();
        }

        private void hideMapCheckBox_CheckedChanged(object sender, EventArgs e)
        {
            mapForm.SetShowMapStatsOnly(hideMapCheckBox.Checked);
        }
    }
}
