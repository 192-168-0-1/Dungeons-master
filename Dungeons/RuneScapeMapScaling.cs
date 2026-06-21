using Dungeons.Common;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Linq;

namespace Dungeons
{
    internal readonly struct RuneScapeMapMatch
    {
        public RuneScapeMapMatch(Point location, FloorSize floorSize, Size canonicalSize, Size captureSize, int scalePercent)
        {
            Location = location;
            FloorSize = floorSize;
            CanonicalSize = canonicalSize;
            CaptureSize = captureSize;
            ScalePercent = scalePercent;
        }

        public Point Location { get; }
        public FloorSize FloorSize { get; }
        public Size CanonicalSize { get; }
        public Size CaptureSize { get; }
        public int ScalePercent { get; }
        public bool IsValid => Location != MapUtils.Invalid;

        public static RuneScapeMapMatch Invalid => new RuneScapeMapMatch(
            MapUtils.Invalid,
            FloorSize.Small,
            Size.Empty,
            Size.Empty,
            100);
    }

    /// <summary>
    /// Locates RuneScape maps rendered with interface scaling and converts their
    /// pixels back to the original 100% map raster used by the desktop reader.
    /// </summary>
    internal static class RuneScapeMapScaling
    {
        private const int MinimumScalePercent = 100;
        private const int MaximumScalePercent = 200;
        private const int ScaleStepPercent = 5;

        public static RuneScapeMapMatch FindMap(
            Bitmap clientCapture,
            IReadOnlyDictionary<FloorSize, Size> canonicalMapSizes)
        {
            if (clientCapture == null || canonicalMapSizes == null)
                return RuneScapeMapMatch.Invalid;

            var candidates = CreateCandidates(canonicalMapSizes);
            using var pixels = new UnsafeBitmap(clientCapture);

            // The special top-right map pixel is much rarer than the normal brown
            // corner pixels. Searching for it first keeps multi-scale calibration fast.
            for (var y = 0; y < pixels.Height; y++)
            {
                for (var right = 0; right < pixels.Width; right++)
                {
                    if (!MapReader.IsMapTopRightCornerColor(pixels.GetPixel(right, y)))
                        continue;

                    // Scaling can turn the one-pixel corner into a short run. Use its
                    // upper-right edge so the derived crop is not shifted by one pixel.
                    if (y > 0 && MapReader.IsMapTopRightCornerColor(pixels.GetPixel(right, y - 1)))
                        continue;
                    if (right + 1 < pixels.Width && MapReader.IsMapTopRightCornerColor(pixels.GetPixel(right + 1, y)))
                        continue;

                    foreach (var candidate in candidates)
                    {
                        var left = right - candidate.CaptureSize.Width + 1;
                        var bottom = y + candidate.CaptureSize.Height - 1;
                        if (left < 0 || bottom >= pixels.Height)
                            continue;

                        if (MapReader.IsMapCornerColor(pixels.GetPixel(left, y))
                            && MapReader.IsMapCornerColor(pixels.GetPixel(left, bottom))
                            && MapReader.IsMapCornerColor(pixels.GetPixel(right, bottom)))
                        {
                            return new RuneScapeMapMatch(
                                new Point(left, y),
                                candidate.FloorSize,
                                candidate.CanonicalSize,
                                candidate.CaptureSize,
                                candidate.ScalePercent);
                        }
                    }
                }
            }

            return RuneScapeMapMatch.Invalid;
        }

        public static Size ScaleSize(Size canonicalSize, int scalePercent)
        {
            return new Size(
                Math.Max(1, (int)Math.Round(canonicalSize.Width * scalePercent / 100.0, MidpointRounding.AwayFromZero)),
                Math.Max(1, (int)Math.Round(canonicalSize.Height * scalePercent / 100.0, MidpointRounding.AwayFromZero)));
        }

        public static Bitmap Normalize(Bitmap source, Size canonicalSize)
        {
            if (source == null)
                return null;
            if (canonicalSize.Width <= 0 || canonicalSize.Height <= 0)
                throw new ArgumentOutOfRangeException(nameof(canonicalSize));
            if (source.Size == canonicalSize)
                return source.Clone(new Rectangle(Point.Empty, source.Size), PixelFormat.Format32bppArgb);

            var normalized = new Bitmap(canonicalSize.Width, canonicalSize.Height, PixelFormat.Format32bppArgb);
            var sourceData = source.LockBits(
                new Rectangle(Point.Empty, source.Size),
                ImageLockMode.ReadOnly,
                PixelFormat.Format32bppArgb);
            var targetData = normalized.LockBits(
                new Rectangle(Point.Empty, normalized.Size),
                ImageLockMode.WriteOnly,
                PixelFormat.Format32bppArgb);

            try
            {
                unsafe
                {
                    for (var y = 0; y < normalized.Height; y++)
                    {
                        var sourceY = Math.Min(source.Height - 1, (int)((y + 0.5) * source.Height / normalized.Height));
                        var sourceRow = (int*)((byte*)sourceData.Scan0 + sourceY * sourceData.Stride);
                        var targetRow = (int*)((byte*)targetData.Scan0 + y * targetData.Stride);

                        for (var x = 0; x < normalized.Width; x++)
                        {
                            var sourceX = Math.Min(source.Width - 1, (int)((x + 0.5) * source.Width / normalized.Width));
                            targetRow[x] = sourceRow[sourceX];
                        }
                    }
                }
            }
            finally
            {
                source.UnlockBits(sourceData);
                normalized.UnlockBits(targetData);
            }

            return normalized;
        }

        private static List<MapScaleCandidate> CreateCandidates(IReadOnlyDictionary<FloorSize, Size> canonicalMapSizes)
        {
            var candidates = new List<MapScaleCandidate>();
            var seen = new HashSet<string>(StringComparer.Ordinal);

            // Prefer the two common cases if more than one percentage rounds to the
            // same pixel dimensions, then cover the rest of RuneScape's useful range.
            var percentages = new[] { 100, 150 }
                .Concat(Enumerable.Range(0, (MaximumScalePercent - MinimumScalePercent) / ScaleStepPercent + 1)
                    .Select(index => MinimumScalePercent + index * ScaleStepPercent))
                .Distinct();

            foreach (var scalePercent in percentages)
            {
                foreach (var pair in canonicalMapSizes)
                {
                    var captureSize = ScaleSize(pair.Value, scalePercent);
                    var key = $"{pair.Key.Width}x{pair.Key.Height}:{captureSize.Width}x{captureSize.Height}";
                    if (seen.Add(key))
                        candidates.Add(new MapScaleCandidate(pair.Key, pair.Value, captureSize, scalePercent));
                }
            }

            return candidates;
        }

        private readonly struct MapScaleCandidate
        {
            public MapScaleCandidate(FloorSize floorSize, Size canonicalSize, Size captureSize, int scalePercent)
            {
                FloorSize = floorSize;
                CanonicalSize = canonicalSize;
                CaptureSize = captureSize;
                ScalePercent = scalePercent;
            }

            public FloorSize FloorSize { get; }
            public Size CanonicalSize { get; }
            public Size CaptureSize { get; }
            public int ScalePercent { get; }
        }
    }
}
