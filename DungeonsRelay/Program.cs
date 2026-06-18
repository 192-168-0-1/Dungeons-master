using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls(GetListenUrl());

var rooms = new ConcurrentDictionary<string, RelayRoom>();
var app = builder.Build();

app.UseWebSockets(new WebSocketOptions
{
    KeepAliveInterval = TimeSpan.FromSeconds(20)
});

app.MapGet("/", () => Results.Text("Dungeons relay is running."));
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Map("/team-sync", async context =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsync("Expected WebSocket.");
        return;
    }

    var roomCode = CleanRoomCode(context.Request.Query["room"].FirstOrDefault());
    if (string.IsNullOrWhiteSpace(roomCode))
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsync("Missing room code.");
        return;
    }

    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    var room = rooms.GetOrAdd(roomCode, code => new RelayRoom(code, app.Logger));
    var peer = room.Add(socket);

    app.Logger.LogInformation("Peer {PeerId} joined room {RoomCode}", peer.Id, roomCode);
    try
    {
        await room.RunAsync(peer, context.RequestAborted);
    }
    finally
    {
        room.Remove(peer);
        app.Logger.LogInformation("Peer {PeerId} left room {RoomCode}", peer.Id, roomCode);
        if (room.IsEmpty)
            rooms.TryRemove(roomCode, out _);
    }
});

app.Run();

static string CleanRoomCode(string? roomCode)
{
    if (string.IsNullOrWhiteSpace(roomCode))
        return string.Empty;

    return new string(roomCode.Where(char.IsLetterOrDigit).ToArray()).ToUpperInvariant();
}

static string GetListenUrl()
{
    var aspNetCoreUrls = Environment.GetEnvironmentVariable("ASPNETCORE_URLS");
    if (!string.IsNullOrWhiteSpace(aspNetCoreUrls))
        return aspNetCoreUrls;

    var port = Environment.GetEnvironmentVariable("PORT");
    return int.TryParse(port, out var parsedPort)
        ? $"http://0.0.0.0:{parsedPort}"
        : "http://0.0.0.0:36596";
}

sealed class RelayRoom
{
    private readonly ConcurrentDictionary<Guid, RelayPeer> peers = new();
    private readonly ILogger logger;

    public RelayRoom(string code, ILogger logger)
    {
        Code = code;
        this.logger = logger;
    }

    public string Code { get; }
    public bool IsEmpty => peers.IsEmpty;

    public RelayPeer Add(WebSocket socket)
    {
        var peer = new RelayPeer(socket);
        peers[peer.Id] = peer;
        return peer;
    }

    public void Remove(RelayPeer peer)
    {
        if (peers.TryRemove(peer.Id, out var removed))
            removed.Dispose();
    }

    public async Task RunAsync(RelayPeer peer, CancellationToken cancellationToken)
    {
        var buffer = new byte[4096];

        while (!cancellationToken.IsCancellationRequested && peer.Socket.State == WebSocketState.Open)
        {
            using var message = new MemoryStream();
            WebSocketReceiveResult result;

            do
            {
                result = await peer.Socket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);
                if (result.MessageType == WebSocketMessageType.Close)
                    return;

                message.Write(buffer, 0, result.Count);
            }
            while (!result.EndOfMessage);

            if (result.MessageType != WebSocketMessageType.Text)
                continue;

            var text = Encoding.UTF8.GetString(message.ToArray());
            if (!string.IsNullOrWhiteSpace(text))
                await BroadcastAsync(text, peer.Id, cancellationToken);
        }
    }

    private async Task BroadcastAsync(string text, Guid senderId, CancellationToken cancellationToken)
    {
        foreach (var peer in peers.Values.ToArray())
        {
            if (peer.Id == senderId)
                continue;

            if (peer.Socket.State != WebSocketState.Open)
            {
                Remove(peer);
                continue;
            }

            try
            {
                await peer.SendAsync(text, cancellationToken);
            }
            catch (Exception ex) when (ex is WebSocketException or ObjectDisposedException or InvalidOperationException)
            {
                logger.LogDebug(ex, "Removing stale relay peer {PeerId} from room {RoomCode}", peer.Id, Code);
                Remove(peer);
            }
        }
    }
}

sealed class RelayPeer : IDisposable
{
    private readonly SemaphoreSlim sendGate = new(1, 1);

    public RelayPeer(WebSocket socket)
    {
        Socket = socket;
    }

    public Guid Id { get; } = Guid.NewGuid();
    public WebSocket Socket { get; }

    public async Task SendAsync(string text, CancellationToken cancellationToken)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        await sendGate.WaitAsync(cancellationToken);
        try
        {
            await Socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, cancellationToken);
        }
        finally
        {
            sendGate.Release();
        }
    }

    public void Dispose()
    {
        sendGate.Dispose();
    }
}
