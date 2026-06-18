using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Dungeons
{
    public class TeamSyncManager : IDisposable
    {
        public const int DefaultPort = 36595;

        private readonly object gate = new object();
        private readonly List<PeerConnection> peers = new List<PeerConnection>();
        private readonly string clientId = Guid.NewGuid().ToString("N");
        private TcpListener listener;
        private ClientWebSocket relaySocket;
        private SemaphoreSlim relaySendGate;
        private CancellationTokenSource cancellation;
        private string displayName = Environment.UserName;
        private string relayRoomCode;

        public event EventHandler<TeamSyncAnnotationEventArgs> AnnotationReceived;
        public event EventHandler<TeamSyncGatestoneEventArgs> GatestoneReceived;
        public event EventHandler<string> ClearAnnotationsReceived;
        public event EventHandler<string> StatusChanged;

        public bool IsConnected { get; private set; }
        public bool IsHosting { get; private set; }
        public bool IsRelayConnected { get; private set; }
        public string RelayRoomCode => relayRoomCode ?? string.Empty;

        public static string CreateRoomCode()
        {
            return Guid.NewGuid().ToString("N").Substring(0, 6).ToUpperInvariant();
        }

        public async Task StartHostAsync(int port, string name)
        {
            Disconnect();
            displayName = CleanName(name);
            cancellation = new CancellationTokenSource();
            listener = new TcpListener(IPAddress.Any, port);
            listener.Start();
            IsConnected = true;
            IsHosting = true;
            IsRelayConnected = false;
            OnStatusChanged($"Hosting on {GetLocalEndpoint(port)}");
            SendHello();
            _ = AcceptLoopAsync(cancellation.Token);
            await Task.CompletedTask;
        }

        public async Task ConnectAsync(string host, int port, string name)
        {
            Disconnect();
            displayName = CleanName(name);
            cancellation = new CancellationTokenSource();

            var tcpClient = new TcpClient();
            await tcpClient.ConnectAsync(host, port);
            AddPeer(tcpClient);
            IsConnected = true;
            IsHosting = false;
            IsRelayConnected = false;
            OnStatusChanged($"Connected to {host}:{port}");
            SendHello();
        }

        public async Task ConnectRelayAsync(string relayUrl, string roomCode, string name)
        {
            Disconnect();
            displayName = CleanName(name);
            relayRoomCode = CleanRoomCode(roomCode);
            cancellation = new CancellationTokenSource();
            relaySocket = new ClientWebSocket();
            relaySendGate = new SemaphoreSlim(1, 1);

            var relayUri = BuildRelayUri(relayUrl, relayRoomCode);
            await relaySocket.ConnectAsync(relayUri, cancellation.Token);

            IsConnected = true;
            IsHosting = false;
            IsRelayConnected = true;
            OnStatusChanged($"Connected to relay room {relayRoomCode}");
            _ = ReadRelayLoopAsync(cancellation.Token);
            SendHello();
        }

        public void Disconnect()
        {
            cancellation?.Cancel();
            cancellation?.Dispose();
            cancellation = null;

            listener?.Stop();
            listener = null;

            relaySocket?.Dispose();
            relaySocket = null;
            relaySendGate?.Dispose();
            relaySendGate = null;
            relayRoomCode = null;

            PeerConnection[] snapshot;
            lock (gate)
            {
                snapshot = peers.ToArray();
                peers.Clear();
            }

            var wasConnected = IsConnected;
            IsConnected = false;
            IsHosting = false;
            IsRelayConnected = false;

            foreach (var peer in snapshot)
                peer.Dispose();

            if (wasConnected)
                OnStatusChanged("Team sync disconnected");
        }

        public void SendAnnotation(Point location, string text)
        {
            if (!IsConnected)
                return;

            Broadcast(CreateMessage("ANN", location.X.ToString(), location.Y.ToString(), text ?? string.Empty));
        }

        public void SendClearAnnotations()
        {
            if (!IsConnected)
                return;

            Broadcast(CreateMessage("CLEAR"));
        }

        public void SendGatestone(int gatestoneIndex, Point location)
        {
            if (!IsConnected)
                return;

            Broadcast(CreateMessage("GAT", gatestoneIndex.ToString(), location.X.ToString(), location.Y.ToString()));
        }

        public void SendHello()
        {
            if (!IsConnected)
                return;

            Broadcast(CreateMessage("HELLO"));
        }

        public void Dispose()
        {
            Disconnect();
        }

        private async Task AcceptLoopAsync(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                try
                {
                    var tcpClient = await listener.AcceptTcpClientAsync();
                    var peer = AddPeer(tcpClient);
                    OnStatusChanged($"Team mate connected from {tcpClient.Client.RemoteEndPoint}");
                    SendHello(peer);
                }
                catch (ObjectDisposedException)
                {
                    return;
                }
                catch (SocketException)
                {
                    if (!token.IsCancellationRequested)
                        OnStatusChanged("Team host stopped accepting connections");
                    return;
                }
            }
        }

        private PeerConnection AddPeer(TcpClient tcpClient)
        {
            var peer = new PeerConnection(tcpClient);
            lock (gate)
                peers.Add(peer);

            _ = ReadLoopAsync(peer, cancellation.Token);
            return peer;
        }

        private async Task ReadLoopAsync(PeerConnection peer, CancellationToken token)
        {
            try
            {
                while (!token.IsCancellationRequested)
                {
                    var line = await peer.Reader.ReadLineAsync();
                    if (line == null)
                        break;

                    HandleMessage(line);

                    if (IsHosting)
                        Broadcast(line, peer);
                }
            }
            catch (IOException)
            {
            }
            catch (ObjectDisposedException)
            {
            }
            finally
            {
                RemovePeer(peer);
            }
        }

        private async Task ReadRelayLoopAsync(CancellationToken token)
        {
            var buffer = new byte[4096];

            try
            {
                while (!token.IsCancellationRequested && relaySocket != null && relaySocket.State == WebSocketState.Open)
                {
                    using (var message = new MemoryStream())
                    {
                        WebSocketReceiveResult result;
                        do
                        {
                            result = await relaySocket.ReceiveAsync(new ArraySegment<byte>(buffer), token);
                            if (result.MessageType == WebSocketMessageType.Close)
                                return;

                            message.Write(buffer, 0, result.Count);
                        }
                        while (!result.EndOfMessage);

                        if (result.MessageType == WebSocketMessageType.Text)
                            HandleMessage(Encoding.UTF8.GetString(message.ToArray()));
                    }
                }
            }
            catch (IOException)
            {
            }
            catch (ObjectDisposedException)
            {
            }
            catch (OperationCanceledException)
            {
            }
            catch (WebSocketException ex)
            {
                if (!token.IsCancellationRequested)
                    OnStatusChanged($"Team relay disconnected: {ex.Message}");
            }
            finally
            {
                if (!token.IsCancellationRequested)
                    Disconnect();
            }
        }

        private void HandleMessage(string line)
        {
            var fields = line.Split('|').Select(Unescape).ToArray();
            if (fields.Length < 4 || fields[0] != "TS1" || fields[1] == clientId)
                return;

            var senderName = string.IsNullOrWhiteSpace(fields[2]) ? "Team mate" : fields[2];
            var type = fields[3];

            if (type == "HELLO")
            {
                OnStatusChanged($"{senderName} joined team sync");
            }
            else if (type == "CLEAR")
            {
                ClearAnnotationsReceived?.Invoke(this, senderName);
            }
            else if (type == "ANN" && fields.Length >= 7
                && int.TryParse(fields[4], out var x)
                && int.TryParse(fields[5], out var y))
            {
                AnnotationReceived?.Invoke(this, new TeamSyncAnnotationEventArgs(new Point(x, y), fields[6], senderName));
            }
            else if (type == "GAT" && fields.Length >= 7
                && int.TryParse(fields[4], out var gatestoneIndex)
                && int.TryParse(fields[5], out var gx)
                && int.TryParse(fields[6], out var gy))
            {
                GatestoneReceived?.Invoke(this, new TeamSyncGatestoneEventArgs(fields[1], senderName, gatestoneIndex, new Point(gx, gy)));
            }
        }

        private void Broadcast(string line, PeerConnection except = null)
        {
            PeerConnection[] snapshot;
            lock (gate)
                snapshot = peers.ToArray();

            foreach (var peer in snapshot)
            {
                if (peer == except)
                    continue;

                try
                {
                    peer.Writer.WriteLine(line);
                    peer.Writer.Flush();
                }
                catch (IOException)
                {
                    RemovePeer(peer);
                }
                catch (ObjectDisposedException)
                {
                    RemovePeer(peer);
                }
            }

            if (IsRelayConnected)
                _ = SendRelayAsync(line);
        }

        private async Task SendRelayAsync(string line)
        {
            var socket = relaySocket;
            var sendGate = relaySendGate;
            if (socket == null || sendGate == null || socket.State != WebSocketState.Open)
                return;

            var failed = false;
            string failure = null;
            try
            {
                var bytes = Encoding.UTF8.GetBytes(line ?? string.Empty);
                await sendGate.WaitAsync();
                try
                {
                    await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
                }
                finally
                {
                    sendGate.Release();
                }
            }
            catch (ObjectDisposedException)
            {
                failed = true;
            }
            catch (InvalidOperationException ex)
            {
                failed = true;
                failure = ex.Message;
            }
            catch (WebSocketException ex)
            {
                failed = true;
                failure = ex.Message;
            }

            if (failed)
            {
                OnStatusChanged(string.IsNullOrWhiteSpace(failure) ? "Team relay disconnected" : $"Team relay disconnected: {failure}");
                Disconnect();
            }
        }

        private void SendHello(PeerConnection peer)
        {
            try
            {
                peer.Writer.WriteLine(CreateMessage("HELLO"));
                peer.Writer.Flush();
            }
            catch (IOException)
            {
                RemovePeer(peer);
            }
        }

        private void RemovePeer(PeerConnection peer)
        {
            lock (gate)
                peers.Remove(peer);

            peer.Dispose();
        }

        private string CreateMessage(string type, params string[] fields)
        {
            var messageFields = new[] { "TS1", clientId, displayName, type }.Concat(fields ?? Enumerable.Empty<string>());
            return string.Join("|", messageFields.Select(Escape));
        }

        private void OnStatusChanged(string text)
        {
            StatusChanged?.Invoke(this, text);
        }

        private static string CleanName(string name)
        {
            return string.IsNullOrWhiteSpace(name) ? Environment.UserName : name.Trim();
        }

        private static string CleanRoomCode(string roomCode)
        {
            var cleaned = new string((roomCode ?? string.Empty).Where(char.IsLetterOrDigit).ToArray()).ToUpperInvariant();
            return string.IsNullOrWhiteSpace(cleaned) ? CreateRoomCode() : cleaned;
        }

        private static Uri BuildRelayUri(string relayUrl, string roomCode)
        {
            relayUrl = string.IsNullOrWhiteSpace(relayUrl) ? "ws://localhost:36596/team-sync" : relayUrl.Trim();
            if (!relayUrl.Contains("://"))
                relayUrl = "wss://" + relayUrl;

            var builder = new UriBuilder(relayUrl);
            if (builder.Scheme == "http")
                builder.Scheme = "ws";
            else if (builder.Scheme == "https")
                builder.Scheme = "wss";

            if (string.IsNullOrWhiteSpace(builder.Path) || builder.Path == "/")
                builder.Path = "team-sync";

            var query = builder.Query.TrimStart('?');
            if (!string.IsNullOrWhiteSpace(query))
                query += "&";
            builder.Query = query + "room=" + Escape(roomCode);
            return builder.Uri;
        }

        private static string Escape(string value)
        {
            return Uri.EscapeDataString(value ?? string.Empty);
        }

        private static string Unescape(string value)
        {
            return Uri.UnescapeDataString(value ?? string.Empty);
        }

        private static string GetLocalEndpoint(int port)
        {
            try
            {
                var address = Dns.GetHostEntry(Dns.GetHostName())
                    .AddressList
                    .FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(a));
                return $"{address ?? IPAddress.Loopback}:{port}";
            }
            catch (SocketException)
            {
                return $"{IPAddress.Loopback}:{port}";
            }
        }

        private sealed class PeerConnection : IDisposable
        {
            private readonly TcpClient client;
            private readonly NetworkStream stream;

            public PeerConnection(TcpClient client)
            {
                this.client = client;
                stream = client.GetStream();
                Reader = new StreamReader(stream);
                Writer = new StreamWriter(stream);
            }

            public StreamReader Reader { get; }
            public StreamWriter Writer { get; }

            public void Dispose()
            {
                Reader.Dispose();
                Writer.Dispose();
                stream.Dispose();
                client.Close();
            }
        }
    }
}
