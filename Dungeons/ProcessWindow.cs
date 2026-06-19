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

        public Bitmap Capture(bool useScreenCapture) => Capture(new Rectangle(Point.Empty, Size), useScreenCapture);

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
            return Capture(region, false);
        }

        public Bitmap Capture(Rectangle region, bool useScreenCapture)
        {
            var size = region.Size;
            if (Handle == IntPtr.Zero)
            {
                var screenBmp = new Bitmap(size.Width, size.Height);
                var source = new Point(
                    SystemInformation.VirtualScreen.X + region.X,
                    SystemInformation.VirtualScreen.Y + region.Y);
                using (var g = Graphics.FromImage(screenBmp))
                {
                    g.CopyFromScreen(source, Point.Empty, size);
                }
                return screenBmp;
            }

            if (useScreenCapture)
                return CaptureFromScreen(region);

            var desktopDC = GetDC(Handle);
            var memoryDC = CreateCompatibleDC(desktopDC);
            var bmp = CreateCompatibleBitmap(desktopDC, size.Width, size.Height);
            var oldBitmap = SelectObject(memoryDC, bmp);
            var success = BitBlt(memoryDC, 0, 0, size.Width, size.Height, desktopDC, region.X, region.Y, SRCCOPY | CAPTUREBLT);

            if (success)
            {
                var result = Image.FromHbitmap(bmp);
                SelectObject(memoryDC, oldBitmap);
                DeleteObject(bmp);
                DeleteDC(memoryDC);
                ReleaseDC(Handle, desktopDC);
                return result;
            }

            return null;
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
