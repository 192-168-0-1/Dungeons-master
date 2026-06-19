using System;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using static Dungeons.NativeMethods;

namespace Dungeons
{
    public class ProcessWindow : IEquatable<ProcessWindow>
    {
        public ProcessWindow(Process process)
        {
            Process = process;
        }

        public Process Process { get; }
        public bool HasExited => Process?.HasExited ?? false;
        public IntPtr Handle => Process?.MainWindowHandle ?? IntPtr.Zero;
        public string Title => Process?.MainWindowTitle ?? "Entire screen";
        public Size Size
        {
            get
            {
                if (GetClientRect(Handle, out var rect))
                    return new Size(rect.Right - rect.Left, rect.Bottom - rect.Top);
                return Size.Empty;
            }
        }

        public Bitmap Capture() => Capture(new Rectangle(Point.Empty, Size));

        public Point ClientToScreen(Point point)
        {
            if (Handle == IntPtr.Zero)
                return new Point(SystemInformation.VirtualScreen.X + point.X, SystemInformation.VirtualScreen.Y + point.Y);

            var nativePoint = new POINT { X = point.X, Y = point.Y };
            return NativeMethods.ClientToScreen(Handle, ref nativePoint)
                ? new Point(nativePoint.X, nativePoint.Y)
                : point;
        }

        public Bitmap Capture(Rectangle region)
        {
            var size = region.Size;
            if (Handle == IntPtr.Zero)
            {
                // Capture entire screen.
                size = SystemInformation.VirtualScreen.Size;
                var screenBmp = new Bitmap(size.Width, size.Height);
                using (var g = Graphics.FromImage(screenBmp))
                {
                    g.CopyFromScreen(SystemInformation.VirtualScreen.X, SystemInformation.VirtualScreen.Y, 0, 0, size);
                }
                return screenBmp;
            }

            var windowCapture = CaptureFromWindowDc(region);
            if (windowCapture != null && !IsMostlyBlack(windowCapture))
                return windowCapture;

            windowCapture?.Dispose();
            return CaptureFromScreen(region);
        }

        private Bitmap CaptureFromWindowDc(Rectangle region)
        {
            var size = region.Size;
            var desktopDC = GetDC(Handle);
            var memoryDC = CreateCompatibleDC(desktopDC);
            var bmp = CreateCompatibleBitmap(desktopDC, size.Width, size.Height);
            var oldBitmap = SelectObject(memoryDC, bmp);
            try
            {
                var success = BitBlt(memoryDC, 0, 0, size.Width, size.Height, desktopDC, region.X, region.Y, SRCCOPY | CAPTUREBLT);
                return success ? (Bitmap)Image.FromHbitmap(bmp) : null;
            }
            finally
            {
                SelectObject(memoryDC, oldBitmap);
                DeleteObject(bmp);
                DeleteDC(memoryDC);
                ReleaseDC(Handle, desktopDC);
            }
        }

        private Bitmap CaptureFromScreen(Rectangle region)
        {
            var screenLocation = ClientToScreen(region.Location);
            var screenBmp = new Bitmap(region.Width, region.Height);
            using (var g = Graphics.FromImage(screenBmp))
            {
                g.CopyFromScreen(screenLocation, Point.Empty, region.Size);
            }
            return screenBmp;
        }

        private static bool IsMostlyBlack(Bitmap bitmap)
        {
            var sampled = 0;
            var black = 0;
            var stepX = Math.Max(1, bitmap.Width / 32);
            var stepY = Math.Max(1, bitmap.Height / 32);

            for (var y = 0; y < bitmap.Height; y += stepY)
            {
                for (var x = 0; x < bitmap.Width; x += stepX)
                {
                    sampled++;
                    var color = bitmap.GetPixel(x, y);
                    if (color.R <= 5 && color.G <= 5 && color.B <= 5)
                        black++;
                }
            }

            return sampled > 0 && black >= sampled * 98 / 100;
        }

        public bool Equals(ProcessWindow other)
        {
            return Process?.Id == other.Process?.Id;
        }

        public override string ToString()
        {
            var size = Size;
            return Process == null ? Title : $"[{size.Width}x{size.Height}] {Title}";
        }

        public override bool Equals(object obj)
        {
            return obj is ProcessWindow x && Equals(x);
        }

        public override int GetHashCode()
        {
            return base.GetHashCode();
        }
    }
}
