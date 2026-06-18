using Dungeons.Common;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace Dungeons
{
    public class MapPictureBox : PictureBox
    {
        const int MaxAnnotationLength = 4;
        const int GatestoneDetectionThreshold = 3;
        const int GatestonePaletteBucketSize = 16;

        static readonly Font AnnotationFont = new Font("Consolas", 7);
        static readonly Font GatestoneFont = new Font("Segoe UI", 7, FontStyle.Bold);
        //static readonly Font DistanceAnnotationFont = new Font("Arial", 7);
        static readonly Color AnnotationColor = Color.FromArgb(140, 240, 240, 240);
        //static readonly Pen AnnotationPen = new Pen(AnnotationColor, 1);
        //static readonly Pen SelectionPen = new Pen(Color.DarkGreen, 1);
        static readonly Brush AnnotationBrush = new SolidBrush(AnnotationColor);
        static readonly Brush OwnGatestoneBrush = new SolidBrush(Color.FromArgb(255, 214, 64));
        static readonly Brush OwnGatestoneTextBrush = Brushes.Black;
        static readonly Brush TeamGatestoneTextBrush = Brushes.White;
        static readonly Pen OwnGatestonePen = new Pen(Color.Black, 1);
        static readonly Pen TeamGatestonePen = new Pen(Color.FromArgb(64, 224, 255), 2);
        static readonly Lazy<GatestonePalettes> GatestonePaletteTemplates = new Lazy<GatestonePalettes>(GatestonePalettes.Load);
        static readonly Color[] TeamGatestoneColors =
        {
            Color.FromArgb(231, 80, 43),
            Color.FromArgb(53, 183, 232),
            Color.FromArgb(82, 190, 76),
            Color.FromArgb(238, 211, 64),
            Color.FromArgb(170, 174, 178)
        };
        //static readonly Brush HomeBrush = Brushes.White;
        //static readonly Brush DefaultRoomBrush = new SolidBrush(Color.FromArgb(128, 255, 255, 255));
        //static readonly Pen GridLinePen = new Pen(Color.FromArgb(32, 255, 255, 255));
        //static readonly Pen PathLinePen = new Pen(Color.FromArgb(80, 255, 255, 255));
        //static readonly Font RoomCountFont = new Font("Georgia", 12);
        //static readonly Brush RoomCountBrush = new SolidBrush(Color.FromArgb(200, 180, 180));

        private readonly string[,] annotations = new string[8, 8];
        private readonly Dictionary<int, Point> localGatestones = new Dictionary<int, Point>();
        private readonly Dictionary<string, TeamGatestoneOwner> teamGatestones = new Dictionary<string, TeamGatestoneOwner>();

        // For key annotations
        private readonly string[] colors = { "c", "o", "y", "go", "gr", "b", "p", "s" };
        private readonly Color[] colorValues =
        {
            Color.FromArgb(155, 255, 178, 206),
            Color.FromArgb(155, Color.Orange),
            Color.FromArgb(155, Color.Yellow),
            Color.FromArgb(155, Color.Gold),
            Color.FromArgb(155, Color.Lime),
            Color.FromArgb(155, Color.SkyBlue),
            Color.FromArgb(155, 214, 178, 255),
            Color.FromArgb(155, Color.Silver)
        };

        private readonly MapReader mapReader;

        public MapPictureBox()
        {
            mapReader = new MapReader(Properties.Resources.ResourceManager);

            ClearAnnotations();
            ReadMap();
        }

        private FloorSize floorSize = FloorSize.Large;
        public FloorSize FloorSize
        {
            get => floorSize;
            set
            {
                if (floorSize != value)
                {
                    floorSize = value;
                    Invalidate();
                }
            }
        }

        public GameMap GameMap { get; private set; } = new GameMap(new RoomType[8, 8]);
        public Point SelectedLocation { get; set; }
        public HashSet<Point> MarkedCriticalRooms { get; private set; } = new HashSet<Point>();
        public HashSet<Point> CriticalRooms { get; private set; } = new HashSet<Point>();
        public bool DrawDistancesEnabled { get; set; }
        public bool ShowCapturedMap { get; set; } = true;
        public Color TransparentBackgroundColor { get; set; } = Color.Transparent;
        public event EventHandler<AnnotationChangedEventArgs> AnnotationChanged;
        public event EventHandler AnnotationsCleared;
        public event EventHandler<GatestoneChangedEventArgs> GatestoneChanged;

        public void ProcessKeyDown(Keys keyData)
        {
            var d = Size.Empty;
            switch (keyData)
            {
                case Keys.Left:
                    d = new Size(-1, 0);
                    break;
                case Keys.Up:
                    d = new Size(0, 1);
                    break;
                case Keys.Right:
                    d = new Size(1, 0);
                    break;
                case Keys.Down:
                    d = new Size(0, -1);
                    break;
                default:
                    break;
            }
            if (!d.IsEmpty && FloorSize.IsInRange(Point.Add(SelectedLocation, d)))
            {
                SelectedLocation = Point.Add(SelectedLocation, d);
                Invalidate();
            }
        }

        public void ProcessKeyPress(KeyPressEventArgs e)
        {
            if (FloorSize.IsInRange(SelectedLocation))
            {
                var i = SelectedLocation.Y;
                var j = SelectedLocation.X;

                if (e.KeyChar == 27)    // Esc
                {
                    SetAnnotation(SelectedLocation, string.Empty);
                }
                else if (e.KeyChar == '\b')
                {
                    if (!string.IsNullOrEmpty(annotations[i, j]))
                        SetAnnotation(SelectedLocation, annotations[i, j].Substring(0, annotations[i, j].Length - 1));
                }
                else if (!char.IsControl(e.KeyChar) && (annotations[i, j] == null || annotations[i, j].Length < MaxAnnotationLength))
                {
                    SetAnnotation(SelectedLocation, annotations[i, j] + e.KeyChar);
                }
            }

            base.OnKeyPress(e);
        }

        public void SetAnnotation(Point location, string text, bool notify = true)
        {
            if (!FloorSize.IsInRange(location))
                return;

            text = text ?? string.Empty;
            if (text.Length > MaxAnnotationLength)
                text = text.Substring(0, MaxAnnotationLength);

            var y = location.Y;
            var x = location.X;
            if (annotations[y, x] == text)
                return;

            annotations[y, x] = text;
            Invalidate();

            if (notify)
                AnnotationChanged?.Invoke(this, new AnnotationChangedEventArgs(location, text));
        }

        public void ClearAnnotations(bool notify = true)
        {
            for (int y = 0; y < annotations.GetLength(0); y++)
                for (int x = 0; x < annotations.GetLength(1); x++)
                    annotations[y, x] = string.Empty;
            Invalidate();

            if (notify)
                AnnotationsCleared?.Invoke(this, EventArgs.Empty);
        }

        public Point GetLocalGatestone(int gatestoneIndex)
        {
            return localGatestones.TryGetValue(gatestoneIndex, out var location) ? location : MapUtils.Invalid;
        }

        public Dictionary<int, Point> GetLocalGatestones()
        {
            return localGatestones.ToDictionary(pair => pair.Key, pair => pair.Value);
        }

        public void SetLocalGatestone(int gatestoneIndex, Point location, bool notify = true)
        {
            if (!IsValidGatestoneIndex(gatestoneIndex))
                return;

            if (location != MapUtils.Invalid && !FloorSize.IsInRange(location))
                return;

            var oldLocation = GetLocalGatestone(gatestoneIndex);
            if (oldLocation == location)
                return;

            if (location == MapUtils.Invalid)
                localGatestones.Remove(gatestoneIndex);
            else
                localGatestones[gatestoneIndex] = location;

            Invalidate();

            if (notify)
                GatestoneChanged?.Invoke(this, new GatestoneChangedEventArgs(gatestoneIndex, location));
        }

        public void SetTeamGatestone(string ownerId, string ownerName, int gatestoneIndex, Point location)
        {
            if (string.IsNullOrWhiteSpace(ownerId) || !IsValidGatestoneIndex(gatestoneIndex))
                return;

            if (location != MapUtils.Invalid && !FloorSize.IsInRange(location))
                return;

            if (!teamGatestones.TryGetValue(ownerId, out var owner))
            {
                owner = new TeamGatestoneOwner(ownerId, ownerName);
                teamGatestones[ownerId] = owner;
            }

            if (!string.IsNullOrWhiteSpace(ownerName) && owner.Name != ownerName)
            {
                owner.Name = ownerName;
            }
            if (location == MapUtils.Invalid)
                owner.Locations.Remove(gatestoneIndex);
            else
                owner.Locations[gatestoneIndex] = location;

            if (owner.Locations.Count == 0)
                teamGatestones.Remove(ownerId);

            Invalidate();
        }

        public void ClearTeamGatestones()
        {
            teamGatestones.Clear();
            Invalidate();
        }

        public int SaveGatestoneDebugCrops(string directory)
        {
            if (Image is not Bitmap bitmap)
                return 0;

            Directory.CreateDirectory(directory);
            bitmap.Save(Path.Combine(directory, "map.png"));

            var count = 0;
            var scoreLines = new List<string> { "Room\tX\tY\tIsRoom\tG1Score\tG2Score" };
            foreach (var location in MapUtils.Range2D(FloorSize.Width, FloorSize.Height))
            {
                var isRoom = GameMap.RoomTypes[location.X, location.Y].IsOpened();
                var scores = GetGatestoneScores(bitmap, location);
                scoreLines.Add($"{location.ToChessString()}\t{location.X}\t{location.Y}\t{isRoom}\t{scores.One}\t{scores.Two}");

                var roomOrigin = FloorSize.MapToClientCoords(location, bitmap.Size);
                var rect = new Rectangle(roomOrigin, new Size(MapUtils.RoomSize, MapUtils.RoomSize));
                if (rect.Left < 0 || rect.Top < 0 || rect.Right > bitmap.Width || rect.Bottom > bitmap.Height)
                    continue;

                using var crop = bitmap.Clone(rect, bitmap.PixelFormat);
                crop.Save(Path.Combine(directory, $"room_{location.ToChessString()}_x{location.X}_y{location.Y}.png"));
                count++;
            }

            File.WriteAllLines(Path.Combine(directory, "scores.tsv"), scoreLines);
            return count;
        }

        public void ReadMap()
        {
            GameMap = mapReader.ReadMap((Bitmap)Image, floorSize);
        }

        public void UpdateLocalGatestonesFromMap()
        {
            if (Image is not Bitmap bitmap)
                return;

            var detected = DetectLocalGatestones(bitmap);
            SetLocalGatestone(1, detected.TryGetValue(1, out var first) ? first : MapUtils.Invalid);
            SetLocalGatestone(2, detected.TryGetValue(2, out var second) ? second : MapUtils.Invalid);
        }

        public RoomType ReadRoom(Point p)
        {
            var pc = FloorSize.MapToClientCoords(p, Image.Size);
            return mapReader.ReadRoom(Image as Bitmap, pc.X, pc.Y);
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            if (Image != null)
            {
                var s = FloorSize.ClientToMapCoords(e.Location, Image.Size);
                if (FloorSize.IsInRange(s))
                {
                    if (e.Button == MouseButtons.Left)
                        SelectedLocation = s;
                    else if (e.Button == MouseButtons.Right && GameMap.IsRoom(s))
                        ToggleMarkedCritical(s);
                    Invalidate();
                }
            }
            base.OnMouseDown(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            if (ShowCapturedMap)
                base.OnPaint(e);
            else
                e.Graphics.Clear(TransparentBackgroundColor);

            e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;

            DrawAnnotations(e);
            DrawGatestones(e);
        }

        protected override void OnPaintBackground(PaintEventArgs pevent)
        {
            if (ShowCapturedMap)
                base.OnPaintBackground(pevent);
            else
                pevent.Graphics.Clear(TransparentBackgroundColor);
        }

        private void ToggleMarkedCritical(Point p)
        {
            if (MarkedCriticalRooms.Contains(p))
                MarkedCriticalRooms.Remove(p);
            else
                MarkedCriticalRooms.Add(p);
            //ComputeCriticalRooms();
        }

        private void DrawAnnotations(PaintEventArgs e)
        {
            if (Image == null)
                return;

            for (int y = 0; y < FloorSize.Height; y++)
            {
                for (int x = 0; x < FloorSize.Width; x++)
                {
                    var ann = annotations[y, x];
                    var colorIndex = colors.Select((c, i) => new { c, i }).FirstOrDefault(c => ann.StartsWith(c.c))?.i;
                    if (ann.StartsWith("bo") || ann == "c" || ann.StartsWith("cri"))
                        colorIndex = null;
                    if (!string.IsNullOrWhiteSpace(ann))
                    {
                        var p = FloorSize.MapToClientCoords(new Point(x, y), Image.Size);
                        using var brush = colorIndex == null ? null : new SolidBrush(colorValues[colorIndex.Value]);
                        e.Graphics.DrawString(ann, AnnotationFont, brush ?? AnnotationBrush, p.X + 2, p.Y + 1);
                    }
                }
            }
        }

        private void DrawGatestones(PaintEventArgs e)
        {
            if (Image == null)
                return;

            foreach (var owner in teamGatestones.Values)
                foreach (var pair in owner.Locations.OrderBy(pair => pair.Key))
                    DrawTeamGatestone(e.Graphics, owner, pair.Key, pair.Value);
        }

        private void DrawTeamGatestone(Graphics g, TeamGatestoneOwner owner, int gatestoneIndex, Point location)
        {
            var p = FloorSize.MapToClientCoords(location, Image.Size);
            const int markerSize = 12;
            var roomCenter = new Point(p.X + MapUtils.RoomSize / 2, p.Y + MapUtils.RoomSize / 2);
            var sameRoomGateCount = owner.Locations.Count(pair => pair.Value == location);
            var xOffset = sameRoomGateCount > 1
                ? gatestoneIndex == 1 ? -markerSize - 1 : 1
                : -markerSize / 2;
            var yOffset = -markerSize / 2;
            var markerRect = new Rectangle(roomCenter.X + xOffset, roomCenter.Y + yOffset, markerSize, markerSize);
            var labelLocation = new Point(markerRect.X + markerSize + 2, markerRect.Y - 1);
            using var fillBrush = new SolidBrush(owner.Color);
            using var shadowBrush = new SolidBrush(Color.FromArgb(210, 0, 0, 0));
            using var borderPen = new Pen(Color.White, 1);
            using var textBrush = new SolidBrush(GetReadableTextColor(owner.Color));
            using var labelBrush = new SolidBrush(owner.Color);

            g.FillEllipse(shadowBrush, markerRect.X + 1, markerRect.Y + 1, markerRect.Width, markerRect.Height);
            g.FillEllipse(fillBrush, markerRect);
            g.DrawEllipse(borderPen, markerRect);
            g.DrawString(gatestoneIndex.ToString(), GatestoneFont, textBrush, markerRect.X + 2, markerRect.Y - 2);
            g.DrawString(GetInitials(owner.Name), GatestoneFont, shadowBrush, labelLocation.X + 1, labelLocation.Y + 1);
            g.DrawString(GetInitials(owner.Name), GatestoneFont, labelBrush, labelLocation);
        }

        private static string GetInitials(string name)
        {
            if (string.IsNullOrWhiteSpace(name))
                return "?";

            var parts = name.Trim().Split(new[] { ' ', '_', '-' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length >= 2)
                return $"{parts[0][0]}{parts[1][0]}".ToUpperInvariant();

            var compact = parts[0];
            return compact.Length == 1 ? compact.ToUpperInvariant() : compact.Substring(0, 2).ToUpperInvariant();
        }

        private static Color GetReadableTextColor(Color background)
        {
            var brightness = (background.R * 299 + background.G * 587 + background.B * 114) / 1000;
            return brightness > 150 ? Color.Black : Color.White;
        }

        private static Color GetTeamGatestoneColor(string ownerId)
        {
            var hash = 17;
            foreach (var ch in ownerId ?? string.Empty)
                hash = hash * 31 + char.ToUpperInvariant(ch);
            return TeamGatestoneColors[(hash & int.MaxValue) % TeamGatestoneColors.Length];
        }

        private static bool IsValidGatestoneIndex(int gatestoneIndex)
        {
            return gatestoneIndex == 1 || gatestoneIndex == 2;
        }

        private Dictionary<int, Point> DetectLocalGatestones(Bitmap bitmap)
        {
            var bestScores = new Dictionary<int, (Point Location, int Score)>();

            foreach (var location in MapUtils.Range2D(FloorSize.Width, FloorSize.Height))
            {
                if (!GameMap.RoomTypes[location.X, location.Y].IsOpened())
                    continue;

                var scores = GetGatestoneScores(bitmap, location);

                TrackBestGatestoneScore(bestScores, 1, location, scores.One);
                TrackBestGatestoneScore(bestScores, 2, location, scores.Two);
            }

            return bestScores
                .Where(pair => pair.Value.Score >= GatestoneDetectionThreshold)
                .ToDictionary(pair => pair.Key, pair => pair.Value.Location);
        }

        private static void TrackBestGatestoneScore(Dictionary<int, (Point Location, int Score)> scores, int gatestoneIndex, Point location, int score)
        {
            if (!scores.TryGetValue(gatestoneIndex, out var best) || score > best.Score)
                scores[gatestoneIndex] = (location, score);
        }

        private (int One, int Two) GetGatestoneScores(Bitmap bitmap, Point location)
        {
            var scoreOne = 0;
            var scoreTwo = 0;
            var roomOrigin = FloorSize.MapToClientCoords(location, bitmap.Size);
            var templates = GatestonePaletteTemplates.Value;

            for (var y = roomOrigin.Y + 8; y < roomOrigin.Y + MapUtils.RoomSize - 5; y++)
            {
                for (var x = roomOrigin.X + 8; x < roomOrigin.X + MapUtils.RoomSize - 8; x++)
                {
                    var color = bitmap.GetPixel(x, y);
                    if (IsFirstGatestonePixel(color))
                        scoreOne++;
                    if (IsSecondGatestonePixel(color))
                        scoreTwo++;
                    if (IsBrightMapMarkerPixel(color))
                    {
                        scoreOne -= 2;
                        scoreTwo -= 2;
                    }
                    if (IsPlayerArrowPixel(color))
                        scoreTwo -= 4;
                    if (templates.IsLoaded && templates.IsGroupGatestonePixel(color))
                        scoreOne -= 2;
                }
            }

            return (Math.Max(0, scoreOne), Math.Max(0, scoreTwo));
        }

        private static bool IsFirstGatestonePixel(Color color)
        {
            return color.A > 200
                && color.R <= 105
                && color.G >= 85
                && color.G <= 190
                && color.B >= 70
                && color.B <= 180
                && color.G - color.R >= 30
                && color.B >= color.G - 25
                && color.B <= color.G + 35;
        }

        private static bool IsSecondGatestonePixel(Color color)
        {
            return color.A > 200
                && color.R >= 35
                && color.R <= 125
                && color.G <= 45
                && color.B >= 8
                && color.B <= 45
                && color.R - color.G >= 20
                && color.R - color.B >= 20;
        }

        private static bool IsPlayerArrowPixel(Color color)
        {
            return color.A > 200
                && color.R >= 95
                && color.G >= 20
                && color.G <= 85
                && color.B <= 12
                && color.R - color.G >= 55;
        }

        private static bool IsBrightMapMarkerPixel(Color color)
        {
            var max = Math.Max(color.R, Math.Max(color.G, color.B));
            var min = Math.Min(color.R, Math.Min(color.G, color.B));
            return color.A > 200
                && max >= 175
                && max - min >= 85;
        }

        private static bool IsPaletteCandidatePixel(Color color)
        {
            var max = Math.Max(color.R, Math.Max(color.G, color.B));
            var min = Math.Min(color.R, Math.Min(color.G, color.B));
            return color.A > 160
                && max >= 35
                && max <= 220
                && max - min >= 25;
        }

        private static int QuantizePaletteColor(Color color)
        {
            return (color.R / GatestonePaletteBucketSize << 16)
                | (color.G / GatestonePaletteBucketSize << 8)
                | (color.B / GatestonePaletteBucketSize);
        }

        private sealed class TeamGatestoneOwner
        {
            public TeamGatestoneOwner(string ownerId, string name)
            {
                Name = string.IsNullOrWhiteSpace(name) ? "Team mate" : name;
                Color = GetTeamGatestoneColor(ownerId);
            }

            public string Name { get; set; }
            public Color Color { get; set; }
            public Dictionary<int, Point> Locations { get; } = new Dictionary<int, Point>();
        }

        private sealed class GatestonePalettes
        {
            private readonly Dictionary<int, HashSet<int>> personalPalettes;
            private readonly HashSet<int> groupPalette;

            private GatestonePalettes(Dictionary<int, HashSet<int>> personalPalettes, HashSet<int> groupPalette)
            {
                this.personalPalettes = personalPalettes;
                this.groupPalette = groupPalette;
            }

            public bool IsLoaded => personalPalettes.Count == 2
                && personalPalettes.Values.All(palette => palette.Count > 0);

            public static GatestonePalettes Load()
            {
                var directory = FindGatestoneTemplateDirectory();
                if (directory == null)
                    return new GatestonePalettes(new Dictionary<int, HashSet<int>>(), new HashSet<int>());

                return new GatestonePalettes(
                    new Dictionary<int, HashSet<int>>
                    {
                        [1] = LoadPalette(Path.Combine(directory, "PersonalGatestone1.png")),
                        [2] = LoadPalette(Path.Combine(directory, "PersonalGatestone2.png"))
                    },
                    LoadPalette(Path.Combine(directory, "GroupGatestone.png")));
            }

            public bool IsPersonalGatestonePixel(int gatestoneIndex, Color color)
            {
                return IsPaletteCandidatePixel(color)
                    && personalPalettes.TryGetValue(gatestoneIndex, out var palette)
                    && palette.Contains(QuantizePaletteColor(color));
            }

            public bool IsGroupGatestonePixel(Color color)
            {
                return IsPaletteCandidatePixel(color)
                    && groupPalette.Contains(QuantizePaletteColor(color));
            }

            private static HashSet<int> LoadPalette(string path)
            {
                var palette = new HashSet<int>();
                if (!File.Exists(path))
                    return palette;

                using var bitmap = new Bitmap(path);
                for (var y = 0; y < bitmap.Height; y++)
                {
                    for (var x = 0; x < bitmap.Width; x++)
                    {
                        var color = bitmap.GetPixel(x, y);
                        if (IsPaletteCandidatePixel(color))
                            palette.Add(QuantizePaletteColor(color));
                    }
                }

                return palette;
            }

            private static string FindGatestoneTemplateDirectory()
            {
                var baseDirectory = AppDomain.CurrentDomain.BaseDirectory;
                var candidates = new[]
                {
                    Path.Combine(baseDirectory, "Gatestones"),
                    Path.GetFullPath(Path.Combine(baseDirectory, @"..\..\..\Common\Resources\Gatestones"))
                };

                return candidates.FirstOrDefault(Directory.Exists);
            }
        }
    }
}
