using Dungeons.Common;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Dungeons
{
    public partial class MapForm : Form
    {
        const int WM_NCLBUTTONDOWN = 0xA1;
        const int HT_CAPTION = 0x2;
        private static readonly Color MapTransparencyKey = Color.FromArgb(1, 0, 1);

        private Point lastHomeLocation = MapUtils.Invalid;
        private int lastRoomCount = 0;
        private readonly MainForm dataWindow;
        private Size startingSize;
        private bool transparentMapEnabled = true;
        private bool autoAlignMapEnabled = true;
        private bool showMapStatsOnly;

        private static readonly Keys[] KeysToEat =
        {
            Keys.Enter,
            Keys.Space,
            Keys.Up,
            Keys.Left,
            Keys.Right,
            Keys.Down
        };

        private static readonly Dictionary<FloorSize, Size> rsMapSizes = new()
        {
            [FloorSize.Small] = new Size(152, 152),
            [FloorSize.Medium] = new Size(152, 280),
            [FloorSize.Large] = new Size(280, 280)
        };

        public MapForm(MainForm dataWindow)
        {
            InitializeComponent();

            FontType.InitializeFonts();
            mapPictureBox.FloorSize = FloorSize;
            mapPictureBox.TransparentBackgroundColor = MapTransparencyKey;
            this.dataWindow = dataWindow;
            BackColor = MapTransparencyKey;
            TransparencyKey = MapTransparencyKey;
            MoveMapControlsToMainForm();
            ApplyMapRenderMode();
        }

        public DateTimeOffset FloorStartTime { get; private set; } = DateTimeOffset.MinValue;
        public int Roomcount => mapPictureBox.GameMap.OpenedRoomCount;
        public int LeafCount => mapPictureBox.GameMap.DeadEndCount;
        public event EventHandler<AnnotationChangedEventArgs> AnnotationChanged
        {
            add => mapPictureBox.AnnotationChanged += value;
            remove => mapPictureBox.AnnotationChanged -= value;
        }

        public event EventHandler AnnotationsCleared
        {
            add => mapPictureBox.AnnotationsCleared += value;
            remove => mapPictureBox.AnnotationsCleared -= value;
        }

        public event EventHandler<GatestoneChangedEventArgs> GatestoneChanged
        {
            add => mapPictureBox.GatestoneChanged += value;
            remove => mapPictureBox.GatestoneChanged -= value;
        }

        public ProcessWindow RSWindow => dataWindow.SelectedWindow;

        public FloorSize FloorSize
        {
            get => mapPictureBox.FloorSize;
            set => mapPictureBox.FloorSize = value;
        }

        public void SaveMap()
        {
            Directory.CreateDirectory(Properties.Settings.Default.MapSaveLocation);
            if (mapPictureBox.Image != null && Directory.Exists(Properties.Settings.Default.MapSaveLocation))
            {
                var fileName = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss");
                mapPictureBox.Image.Save(Path.Combine(Properties.Settings.Default.MapSaveLocation, $"map_{fileName}.png"));
                Log("Map saved!");
            }
        }

        public async Task CalibrateAsync()
        {
            var (mapLocation, floorSize) = await FindMapAsync();
            if (mapLocation != MapUtils.Invalid)
            {
                Log($"Calibrated! Map location = {mapLocation}, Size = {floorSize}");
                Properties.Settings.Default.MapLocation = mapLocation;
                Properties.Settings.Default.Save();
                UpdateMap();
            }
            else
            {
                Log($"Could not find map. Current map search location = {Properties.Settings.Default.MapLocation}");
                SaveCalibrationDebug();
            }
        }

        public void SetShowMapStatsOnly(bool value)
        {
            showMapStatsOnly = value;
            ApplyMapRenderMode();
        }

        public void SetTransparentMap(bool value)
        {
            transparentMapEnabled = value;
            ApplyMapRenderMode();
        }

        public void SetAutoAlignMap(bool value)
        {
            autoAlignMapEnabled = value;
            AlignOverlayToRuneScapeMap(dataWindow.SelectedWindow);
        }

        public void SetMapTopMost(bool value)
        {
            TopMost = value;
        }

        public void ClearAnnotations()
        {
            mapPictureBox.ClearAnnotations();
        }

        public void SaveGatestoneDebug()
        {
            var directory = Path.GetFullPath(Path.Combine(
                Properties.Settings.Default.MapSaveLocation,
                "GatestoneDebug",
                DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss")));
            var count = mapPictureBox.SaveGatestoneDebugCrops(directory);
            Log(count == 0
                ? "Gate debug export failed: no map image active."
                : $"Gate debug export saved {count} crops to {directory}");
        }

        public void ApplyTeamAnnotation(Point location, string text)
        {
            mapPictureBox.SetAnnotation(location, text, false);
        }

        public void ApplyTeamClearAnnotations()
        {
            mapPictureBox.ClearAnnotations(false);
        }

        public void ApplyTeamGatestone(string ownerId, string ownerName, int gatestoneIndex, Point location)
        {
            mapPictureBox.SetTeamGatestone(ownerId, ownerName, gatestoneIndex, location);
        }

        public Dictionary<int, Point> GetLocalGatestones()
        {
            return mapPictureBox.GetLocalGatestones();
        }

        public void ClearTeamGatestones()
        {
            mapPictureBox.ClearTeamGatestones();
        }

        private void MoveMapControlsToMainForm()
        {
            Controls.Remove(minusTenButton);
            Controls.Remove(plusOneButton);
            Controls.Remove(plusTenButton);
            Controls.Remove(resetTimerButton);
            Controls.Remove(timerLabel);
            Controls.Remove(clearAnnotationsButton);
            Controls.Remove(topMostCheckBox);
            Controls.Remove(tableLayoutPanel1);

            flowLayoutPanel.BackColor = MapTransparencyKey;
            mapPictureBox.BackColor = MapTransparencyKey;
            dataLabel.BackColor = Color.Black;
            UpdateOverlayLayout();
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (KeysToEat.Contains(keyData))
            {
                mapPictureBox.ProcessKeyDown(keyData);
                UpdateDataLabel();
                return true;
            }
            return base.ProcessCmdKey(ref msg, keyData);
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button == MouseButtons.Left)
            {
                NativeMethods.ReleaseCapture();
                NativeMethods.SendMessage(Handle, WM_NCLBUTTONDOWN, (IntPtr)HT_CAPTION, IntPtr.Zero);
            }
        }

        protected override void OnKeyPress(KeyPressEventArgs e)
        {
            mapPictureBox.ProcessKeyPress(e);
            base.OnKeyPress(e);
        }

        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            startingSize = Size;
            var isValidLocation = false;

            if (Screen.FromPoint(Properties.Settings.Default.MapFormLocation) != null)
            {
                Location = Properties.Settings.Default.MapFormLocation;
                isValidLocation = this.IsOnScreen();
            }
            if (!isValidLocation)
            {
                // Start on top right, lol
                Location = new Point(Screen.PrimaryScreen.WorkingArea.Width - Width, 0);
            }
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            base.OnFormClosed(e);
            Application.Exit();
        }

        private async Task<(Point, FloorSize)> FindMapAsync()
        {
            var window = dataWindow.SelectedWindow;
            if (window != null && !window.HasExited)
            {
                using var bmp = window.Capture();
                // Search for map marker
                foreach (var floorSize in FloorSize.RSSizes)
                {
                    var match = await Task.Run(() => UnsafeBitmap.FindMapByCorners(bmp, rsMapSizes[floorSize]));
                    if (match != MapUtils.Invalid)
                    {
                        return (match, floorSize);
                    }
                }
            }

            return (MapUtils.Invalid, FloorSize.Small);
        }

        private void SaveCalibrationDebug()
        {
            var window = dataWindow.SelectedWindow;
            if (window == null || window.HasExited)
                return;

            using var bmp = window.Capture();
            if (bmp == null)
                return;

            var directory = Path.GetFullPath(Path.Combine(
                Properties.Settings.Default.MapSaveLocation,
                "CalibrationDebug"));
            Directory.CreateDirectory(directory);

            var timestamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss");
            var imagePath = Path.Combine(directory, $"client_{timestamp}.png");
            var infoPath = Path.Combine(directory, $"client_{timestamp}.txt");

            bmp.Save(imagePath);
            File.WriteAllLines(infoPath, new[]
            {
                $"Window: {window.Title}",
                $"Client size: {window.Size.Width}x{window.Size.Height}",
                $"Current map search location: {Properties.Settings.Default.MapLocation}",
                $"Expected map sizes: {string.Join(", ", rsMapSizes.Select(pair => $"{pair.Key}={pair.Value.Width}x{pair.Value.Height}"))}"
            });

            Log($"Calibration debug saved to {imagePath}");
        }

        private void UpdateMap()
        {
            var window = dataWindow.SelectedWindow;
            if (window == null || window.HasExited)
            {
                dataWindow.RefreshProcessesList();
                return;
            }

            foreach (var floorSize in FloorSize.RSSizes)
            {
                if (Properties.Settings.Default.MapLocation != MapUtils.Invalid)
                {
                    var mapSize = rsMapSizes[floorSize];
                    var bmp = window.Capture(new Rectangle(Properties.Settings.Default.MapLocation, mapSize));
                    if (bmp == null)
                        return; // Break out of the loop, window capture won't work for the other cases either.

                    if (MapReader.IsValidInGameMap(bmp))
                    {
                        FloorSize = floorSize;
                        mapPictureBox.Size = LogicalToDeviceUnits(mapSize);
                        UpdateOverlayLayout();
                        AlignOverlayToRuneScapeMap(window);
                        timer.Start();
                        if (mapPictureBox.Image != null)
                            mapPictureBox.Image.Dispose();
                        mapPictureBox.Image = bmp;
                        mapPictureBox.ReadMap();
                        mapPictureBox.UpdateLocalGatestonesFromMap();
                        UpdateDataLabel();

                        // Reset when home changes or on first map load
                        if (FloorStartTime == DateTimeOffset.MinValue || (mapPictureBox.GameMap.Base != MapUtils.Invalid
                            && lastHomeLocation != MapUtils.Invalid
                            && mapPictureBox.GameMap.Base != lastHomeLocation)
                            || (lastRoomCount > 1 && mapPictureBox.GameMap.OpenedRoomCount == 1))
                        {
                            FloorStartTime = DateTimeOffset.Now.AddSeconds(-2);
                        }
                        // Found a floor size that aligns correctly with the rooms, this must be the right one.
                        lastRoomCount = mapPictureBox.GameMap.OpenedRoomCount;
                        if (mapPictureBox.GameMap.Base != MapUtils.Invalid)
                            lastHomeLocation = mapPictureBox.GameMap.Base;
                        break;
                    }
                    else
                    {
                        bmp.Dispose();
                    }
                }
            }
        }

        private void UpdateDataLabel()
        {
            var minutes = GetElapsedTime().TotalMinutes;
            var roomsPerMinStr = ((mapPictureBox.GameMap.OpenedRoomCount - 0.8) / minutes).ToString("0.0");
            var c = mapPictureBox.GameMap.OpenedRoomCount;
            var m = mapPictureBox.GameMap.MysteryCount;
            var roomsText = c == 1 ? "room" : "rooms";
            dataLabel.Text = $"{c} {roomsText} ({c + m}) | {roomsPerMinStr} rpm | {mapPictureBox.GameMap.DeadEndCount} dead ends";
        }

        private TimeSpan GetElapsedTime()
        {
            return DateTimeOffset.Now - FloorStartTime;
        }

        private void Log(string text)
        {
            dataWindow.Log(text);
        }

        private async void CalibrateButton_Click(object sender, EventArgs e)
        {
            await CalibrateAsync();
        }

        private void Timer_Tick(object sender, EventArgs e)
        {
            UpdateMap();

            if (FloorStartTime != DateTimeOffset.MinValue)
            {
                UpdateDataLabel();
            }
        }

        private void SaveMapButton_Click(object sender, EventArgs e)
        {
            SaveMap();
        }

        private void MapPictureBox_MouseDown(object sender, MouseEventArgs e)
        {
            UpdateDataLabel();
        }

        private void ClearAnnotationsButton_Click(object sender, EventArgs e)
        {
            mapPictureBox.ClearAnnotations();
        }

        private void TopMostCheckBox_CheckedChanged(object sender, EventArgs e)
        {
            SetMapTopMost(topMostCheckBox.Checked);
        }

        private void ApplyMapRenderMode()
        {
            if (mapPictureBox == null)
                return;

            mapPictureBox.ShowCapturedMap = !transparentMapEnabled && !showMapStatsOnly;
            mapPictureBox.BackColor = mapPictureBox.ShowCapturedMap ? Color.Black : MapTransparencyKey;
            mapPictureBox.Invalidate();
        }

        private void AlignOverlayToRuneScapeMap(ProcessWindow window)
        {
            if (!autoAlignMapEnabled || window == null || window.HasExited)
                return;

            if (Properties.Settings.Default.MapLocation == MapUtils.Invalid)
                return;

            var mapScreenLocation = window.ClientToScreen(Properties.Settings.Default.MapLocation);
            if (Location != mapScreenLocation)
                Location = mapScreenLocation;
        }

        private void UpdateOverlayLayout()
        {
            var statsHeight = dataLabel.Height + dataLabel.Margin.Vertical;
            var width = Math.Max(mapPictureBox.Width, dataLabel.PreferredWidth + dataLabel.Margin.Horizontal);
            var height = mapPictureBox.Height + statsHeight;
            flowLayoutPanel.Size = new Size(width, height);
            ClientSize = new Size(width, height);
        }

        private void ResetTimerButton_Click(object sender, EventArgs e)
        {
            FloorStartTime = DateTimeOffset.Now;
        }

        private void PlusOneOrTenButton_Click(object sender, EventArgs e)
        {
            if (FloorStartTime != DateTimeOffset.MinValue)
            {
                if (sender == plusOneButton)
                    FloorStartTime = FloorStartTime.AddSeconds(-1);
                else if (sender == plusTenButton)
                    FloorStartTime = FloorStartTime.AddSeconds(-10);
                else
                    FloorStartTime = FloorStartTime.AddSeconds(10);
            }
        }

        private void CloseButton_Click(object sender, EventArgs e)
        {
            Close();
        }

        private void flowLayoutPanel_MouseDown(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left)
            {
                NativeMethods.ReleaseCapture();
                NativeMethods.SendMessage(Handle, WM_NCLBUTTONDOWN, (IntPtr)HT_CAPTION, IntPtr.Zero);
            }
        }

        private void dataLabel_MouseDown(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left)
            {
                NativeMethods.ReleaseCapture();
                NativeMethods.SendMessage(Handle, WM_NCLBUTTONDOWN, (IntPtr)HT_CAPTION, IntPtr.Zero);
            }
        }
    }
}
