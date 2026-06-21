using System;

namespace Dungeons.ScreenCapture
{
    public static class WindowCapturePolicy
    {
        private const uint ExcludeFromCapture = 0x00000011;

        public static bool TryExclude(IntPtr windowHandle)
        {
            return windowHandle != IntPtr.Zero &&
                   CaptureNativeMethods.SetWindowDisplayAffinity(windowHandle, ExcludeFromCapture);
        }
    }
}
