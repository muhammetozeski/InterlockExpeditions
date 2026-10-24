using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using InterlockExpeditions.Portal.Models;

namespace InterlockExpeditions.Portal.Services;

/// <summary>A deliberate public service rejection, distinct from an unknown transport outcome.</summary>
public sealed class ExpeditionFailure(HttpStatusCode status, string message) : Exception(message) { public HttpStatusCode Status { get; } = status; }

/// <summary>Same-origin typed API and per-request player authority; mutation retries reuse their pending nonce.</summary>
public sealed class ExpeditionApi(HttpClient http, ILogger<ExpeditionApi> logger)
{
    const bool IsLogEnabled = true;
    readonly Dictionary<string, (string Signature, string Nonce)> Pending = [];
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public Task<EpisodeList> EpisodesAsync() => GetAsync<EpisodeList>("episodes");
    public Task<AccountResult> AccountAsync() => GetAsync<AccountResult>("account");
    public Task<AccountResult> CreateAccountAsync(string alias) => SendAsync<AccountResult>(HttpMethod.Post, "accounts", new { alias });
    public Task<AccountResult> RecoverAccountAsync(string recoveryKey) => SendAsync<AccountResult>(HttpMethod.Post, "sessions", new { recoveryKey });
    public Task<JsonElement> LogoutAsync() => SendAsync<JsonElement>(HttpMethod.Post, "logout", new { });
    public Task<JsonElement> DeleteAccountAsync(string confirmation) => SendAsync<JsonElement>(HttpMethod.Post, "account/delete", new { confirmation });
    public Task<RoomList> RoomsAsync() => GetAsync<RoomList>("rooms");
    public Task<RoomControl> ControlAsync(string roomId, CancellationToken cancellationToken = default) => GetAsync<RoomControl>("rooms/" + Id(roomId) + "/control", cancellationToken: cancellationToken);
    public Task<RoomControl> CreateRoomAsync(string episodeId, string title, int durationMinutes) => MutateAsync<RoomControl>("new-room", "rooms", nonce => new { requestId = nonce, episodeId, title, durationMinutes });
    public Task<RoomControl> HostAsync(string roomId, string type, string? playerId = null) => MutateAsync<RoomControl>("host:" + roomId, "rooms/" + Id(roomId) + "/host", nonce => new { requestId = nonce, type, playerId });
    public Task<JsonElement> DeleteRoomAsync(string roomId, string confirmation) => SendAsync<JsonElement>(HttpMethod.Post, "rooms/" + Id(roomId) + "/delete", new { confirmation });
    public Task<PlayState> JoinAsync(string roomId, string code, string alias, string role) => MutateAsync<PlayState>("join:" + roomId, "rooms/" + Id(roomId) + "/join", nonce => new { requestId = nonce, code, alias, role });
    public Task<PlayState> PlayAsync(string roomId, PlayerIdentity? player = null, CancellationToken cancellationToken = default) => GetAsync<PlayState>("rooms/" + Id(roomId) + "/play", player, cancellationToken);
    public Task<PlayState> ActAsync(string roomId, string stageId, object action, PlayerIdentity player) => MutateAsync<PlayState>("act:" + roomId, "rooms/" + Id(roomId) + "/action", nonce => new { requestId = nonce, stageId, action }, player);
    public Task<JsonElement> ReportAsync(string roomId, string reason, string note, PlayerIdentity player) => SendAsync<JsonElement>(HttpMethod.Post, "rooms/" + Id(roomId) + "/report", new { reason, note }, player);
    public Task<T> GetAsync<T>(string path, PlayerIdentity? player = null, CancellationToken cancellationToken = default) => SendAsync<T>(HttpMethod.Get, path, null, player, cancellationToken);

    async Task<T> MutateAsync<T>(string scope, string path, Func<string, object> payload, PlayerIdentity? player = null)
    {
        var signature = JsonSerializer.Serialize(payload("signature"), Json);
        if (!Pending.TryGetValue(scope, out var pending) || pending.Signature != signature) pending = (signature, Guid.NewGuid().ToString());
        Pending[scope] = pending;
        var result = await SendAsync<T>(HttpMethod.Post, path, payload(pending.Nonce), player);
        Pending.Remove(scope);
        return result;
    }

    async Task<T> SendAsync<T>(HttpMethod method, string path, object? payload, PlayerIdentity? player = null, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(method, "/api/" + path);
        if (payload is not null) request.Content = JsonContent.Create(payload);
        if (player is not null)
        {
            if (!path.StartsWith("rooms/" + Id(player.RoomId) + "/", StringComparison.Ordinal) || player.Key.Length != 64 || player.Key.Any(character => !Uri.IsHexDigit(character))) throw new FormatException("The saved player identity does not match this room.");
            request.Headers.Add("X-IE-Player", Id(player.Id)); request.Headers.Add("X-IE-Key", player.Key);
        }
        var stopwatch = Stopwatch.StartNew();
        try
        {
            using var response = await http.SendAsync(request, cancellationToken);
            if (IsLogEnabled) logger.LogInformation("Expedition API response; method={Method}; status={Status}; payloadPresent={PayloadPresent}", method.Method, (int)response.StatusCode, payload is not null);
            if (!response.IsSuccessStatusCode) { var failure = await response.Content.ReadFromJsonAsync<Failure>(cancellationToken: cancellationToken); throw new ExpeditionFailure(response.StatusCode, failure?.Error ?? "The action was not accepted."); }
            return await response.Content.ReadFromJsonAsync<T>(cancellationToken: cancellationToken) ?? throw new InvalidOperationException("The room service returned an empty response.");
        }
        catch (Exception error) { if (IsLogEnabled) logger.LogWarning("Expedition API failed; type={Type}; status={Status}", error.GetType().Name, error is ExpeditionFailure failure ? (int)failure.Status : 0); throw; }
        finally { stopwatch.Stop(); if (IsLogEnabled) logger.LogInformation("Expedition API finished; elapsedMs={Elapsed}", stopwatch.Elapsed.TotalMilliseconds); }
    }
    static string Id(string value) => Guid.TryParseExact(value, "D", out _) ? value : throw new FormatException("Choose a valid room or player identity.");
    sealed class Failure { public string Error { get; set; } = ""; }
}
