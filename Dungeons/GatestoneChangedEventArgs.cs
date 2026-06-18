using System;
using System.Drawing;

namespace Dungeons
{
    public class GatestoneChangedEventArgs : EventArgs
    {
        public GatestoneChangedEventArgs(int gatestoneIndex, Point location)
        {
            GatestoneIndex = gatestoneIndex;
            Location = location;
        }

        public int GatestoneIndex { get; }
        public Point Location { get; }
    }
}
