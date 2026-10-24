using InterlockExpeditions.Portal.Models;

namespace InterlockExpeditions.Portal.Shared;

/// <summary>Refreshes live room projections while preserving newer revisions and cancelling work when a page closes.</summary>
public abstract class LiveExpeditionPage : ExpeditionPage, IAsyncDisposable
{
    protected readonly CancellationTokenSource Lifetime = new();
    Task? Watching;
    long ClockOffset;
    protected long ServerClock => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + ClockOffset;
    protected void ObserveClock(Room room) => ClockOffset = room.ServerNow - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    protected string Clock(Room room) { var milliseconds = room.Status == "active" ? Math.Max(0, room.RemainingMs - (ServerClock - room.ServerNow)) : room.RemainingMs; var span = TimeSpan.FromMilliseconds(milliseconds); return $"{(int)span.TotalMinutes:00}:{span.Seconds:00}"; }
    /// <summary>Runs a bounded polling cadence; the server remains authoritative and the local timer is only a display.</summary>
    protected void Watch(Func<Task> refresh, Func<bool> finished)
    {
        if (Watching is null || Watching.IsCompleted) Watching = WatchAsync(refresh, finished);
    }
    async Task WatchAsync(Func<Task> refresh, Func<bool> finished)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1)); var ticks = 0;
        try
        {
            while (await timer.WaitForNextTickAsync(Lifetime.Token))
            {
                if (finished()) return;
                await InvokeAsync(async () =>
                {
                    if (++ticks % 4 == 0 && !Busy)
                    {
                        try { await refresh(); }
                        catch (OperationCanceledException) when (Lifetime.IsCancellationRequested) { return; }
                        catch (Exception error) { Status = "The last room update could not be read. The service still owns your progress; refresh when the connection returns."; HasError = true; Logger.LogWarning("Room refresh failed; type={Type}", error.GetType().Name); }
                    }
                    if (!Lifetime.IsCancellationRequested) StateHasChanged();
                });
            }
        }
        catch (OperationCanceledException) when (Lifetime.IsCancellationRequested) { }
    }
    protected virtual ValueTask DisposeBrowserAsync() => ValueTask.CompletedTask;
    public async ValueTask DisposeAsync() { Lifetime.Cancel(); if (Watching is not null) await Watching; await DisposeBrowserAsync(); Lifetime.Dispose(); }
}
